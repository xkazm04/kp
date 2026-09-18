// One director EXCHANGE, server-side (spark ai-interview-parity; ADR 0010): what
// POST /api/interview/director runs once the route has resolved the token, refused
// what it must and spent the per-token budget.
//
//   parse   — the request's turns, browser observations and tool call are UNTRUSTED
//             (a public token route): each is validated, clamped and bounded here;
//   persist — new turns (idempotent per attempt+seq) and observations;
//   apply   — at most one tool call (voice/director.ts applyDirectorTool);
//   decide  — at most one stage direction (decideDirective), itself persisted so the
//             dedupe window survives across requests;
//   answer  — a DirectorResponse PROJECTION: ids, the tool result, the directive. No
//             competency, no goal, no brief — the response lands in the candidate's
//             browser.
//
// The read → compute → write runs inside ONE IMMEDIATE transaction
// (withInterviewEventsLock): two requests for the same call — a retry racing its
// original, a tool call racing a heartbeat — serialize instead of both deciding the
// same directive or both recording the same tool call. Everything inside is
// synchronous by construction.

import { clampTurn } from "../interview-transcript";
import {
  appendInterviewEvents,
  listInterviewEvents,
  maxInterviewTurnSeq,
  withInterviewEventsLock,
  type InterviewEvent,
  type NewInterviewEvent,
} from "../db/interview-events";
import { touchInterviewActivity, type InterviewSession } from "../db/interviews";
import {
  applyDirectorTool,
  decideDirective,
  deriveDirectorState,
  directorAgendaState,
  endCeilingMin,
  type DirectorToolCallInput,
  type DirectorToolOutcome,
} from "./director";
import type { DirectorClientEvent, DirectorResponse, DirectorTurn } from "./director-types";

/** Turns accepted per request; the rest are simply not acknowledged (ackSeq) and the
 *  browser resends them — natural backpressure, no refusal. */
export const MAX_DIRECTOR_TURNS_PER_REQUEST = 50;
/** Browser observations accepted per request. */
export const MAX_DIRECTOR_CLIENT_EVENTS_PER_REQUEST = 20;
/** A turn number above this is not a real call's. */
export const MAX_DIRECTOR_TURN_SEQ = 100_000;
/** Once a session holds this many events, new turns/observations are no longer stored
 *  (the director keeps answering). A 45-minute call writes a few hundred. */
export const MAX_INTERVIEW_EVENTS_PER_SESSION = 4000;
/** A browser timestamp older than this (or in the server's future) is replaced by the
 *  server's record time. */
const MAX_CLIENT_LAG_MS = 6 * 60 * 60_000;
/** Longest accepted tool-call id / name. */
const MAX_CALL_ID_CHARS = 200;
const MAX_TOOL_NAME_CHARS = 64;
/** Upper bound on a millisecond observation (a day) — anything larger is noise. */
const MAX_OBSERVED_MS = 24 * 60 * 60_000;

// ---- parsing (untrusted input) -----------------------------------------------------

/** The turns of a request, validated and clamped exactly like the hang-up transcript
 *  (interview-transcript.ts clampTurn): unknown roles become `system` (never
 *  `candidate`), text is capped at MAX_TURN_TEXT_CHARS, a turn without a usable seq or
 *  text is dropped. Sorted by seq, duplicates within the request collapsed, bounded. */
export function parseDirectorTurns(raw: unknown): DirectorTurn[] {
  if (!Array.isArray(raw)) return [];
  const bySeq = new Map<number, DirectorTurn>();
  for (const item of raw.slice(0, MAX_DIRECTOR_TURNS_PER_REQUEST * 4)) {
    if (item === null || typeof item !== "object") continue;
    const t = item as { seq?: unknown; role?: unknown; text?: unknown; at?: unknown };
    if (!Number.isSafeInteger(t.seq) || (t.seq as number) < 0 || (t.seq as number) > MAX_DIRECTOR_TURN_SEQ) continue;
    if (typeof t.text !== "string" || t.text.trim().length === 0) continue;
    const { turn } = clampTurn({ role: t.role, text: t.text, at: t.at });
    if (!bySeq.has(t.seq as number)) bySeq.set(t.seq as number, { seq: t.seq as number, role: turn.role, text: turn.text, at: turn.at ?? "" });
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(0, MAX_DIRECTOR_TURNS_PER_REQUEST);
}

function finiteMs(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(0, Math.round(v)), MAX_OBSERVED_MS) : null;
}

/** The browser-only observations of a request. Only the three kinds the contract names
 *  survive, each re-built field by field (nothing unlisted is stored). */
export function parseDirectorClientEvents(raw: unknown): DirectorClientEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: DirectorClientEvent[] = [];
  for (const item of raw) {
    if (out.length >= MAX_DIRECTOR_CLIENT_EVENTS_PER_REQUEST) break;
    if (item === null || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const at = typeof e.at === "string" && e.at.length <= 40 ? e.at : "";
    if (e.kind === "focus_lost") {
      const during = e.during === "candidate" || e.during === "interviewer" || e.during === "idle" ? e.during : null;
      if (during) out.push({ kind: "focus_lost", at, during });
    } else if (e.kind === "focus_returned") {
      const awayMs = finiteMs(e.awayMs);
      if (awayMs !== null) out.push({ kind: "focus_returned", at, awayMs });
    } else if (e.kind === "answer_timing") {
      if (!Number.isSafeInteger(e.turnSeq) || (e.turnSeq as number) < 0 || (e.turnSeq as number) > MAX_DIRECTOR_TURN_SEQ) continue;
      out.push({
        kind: "answer_timing",
        at,
        turnSeq: e.turnSeq as number,
        preSilenceMs: finiteMs(e.preSilenceMs),
        durationMs: finiteMs(e.durationMs),
      });
    }
  }
  return out;
}

/** The request's tool call, or null. A call with no usable name is dropped (the
 *  browser then answers the model itself); anything else reaches applyDirectorTool,
 *  which answers every malformed shape with "continue". */
export function parseDirectorTool(raw: unknown): DirectorToolCallInput | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const t = raw as { callId?: unknown; name?: unknown; args?: unknown };
  if (typeof t.name !== "string" || t.name.length === 0 || t.name.length > MAX_TOOL_NAME_CHARS) return null;
  const callId = typeof t.callId === "string" ? t.callId.slice(0, MAX_CALL_ID_CHARS) : "";
  return { callId, name: t.name, args: t.args };
}

/** A browser timestamp, kept when plausible; otherwise the server's record time. */
export function clampClientAt(at: string, nowMs: number): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t) || t > nowMs || t < nowMs - MAX_CLIENT_LAG_MS) return new Date(nowMs).toISOString();
  return new Date(t).toISOString();
}

// ---- the exchange -------------------------------------------------------------------

export type DirectorStepSession = Pick<InterviewSession, "id" | "workspaceId" | "agenda" | "attempts" | "startedAt" | "updatedAt">;

export type DirectorStepInput = {
  session: DirectorStepSession;
  turns: readonly DirectorTurn[];
  events: readonly DirectorClientEvent[];
  tool: DirectorToolCallInput | null;
  nowMs: number;
};

function candidateTurnTexts(events: readonly InterviewEvent[]): string[] {
  return events
    .filter((e) => e.kind === "turn" && e.payload.role === "candidate" && typeof e.payload.text === "string")
    .map((e) => e.payload.text as string);
}

/** The connect time of the current attempt: /connect stamps updated_at on every
 *  (re)connect (markInterviewStarted), started_at only on the first. */
function attemptStartedAtMs(session: DirectorStepSession): number | null {
  const t = Date.parse(session.updatedAt ?? session.startedAt ?? "");
  return Number.isFinite(t) ? t : null;
}

/** Run one director exchange for a live session. Synchronous; one IMMEDIATE transaction. */
export function runDirectorStep(input: DirectorStepInput): DirectorResponse {
  const { session, nowMs } = input;
  const workspaceId = session.workspaceId;
  const attempt = session.attempts;
  const agenda = session.agenda;
  const nowIso = new Date(nowMs).toISOString();
  const startedAt = attemptStartedAtMs(session);
  const stateOf = (events: readonly InterviewEvent[]) =>
    deriveDirectorState({ agenda, events, currentAttempt: attempt, attemptStartedAtMs: startedAt, nowMs });

  return withInterviewEventsLock(() => {
    // Keep the call LIVE for the single-live and reissue guards while its browser is
    // talking to the director (a directed call can outlast the connect-time window).
    touchInterviewActivity(session.id, nowIso);
    let events = listInterviewEvents(session.id, workspaceId, { limit: MAX_INTERVIEW_EVENTS_PER_SESSION + 100 });
    const before = stateOf(events);
    // Past the per-session ceiling nothing more is stored — the director still answers.
    const canStore = events.length < MAX_INTERVIEW_EVENTS_PER_SESSION;

    // 1. Persist what the browser observed — turns tagged with the block they fell in.
    if (canStore) {
      const rows: NewInterviewEvent[] = [];
      for (const t of input.turns) {
        rows.push({
          sessionId: session.id,
          attempt,
          seq: t.seq,
          kind: "turn",
          blockId: before.activeBlockId,
          payload: { role: t.role, text: t.text },
          at: clampClientAt(t.at, nowMs),
        });
      }
      for (const e of input.events) {
        const { kind, at, ...fields } = e;
        rows.push({
          sessionId: session.id,
          attempt,
          kind,
          blockId: before.activeBlockId,
          payload: fields,
          at: clampClientAt(at, nowMs),
        });
      }
      events = [...events, ...appendInterviewEvents(rows, workspaceId, nowIso)];
    }

    // 2. At most one tool call.
    let outcome: DirectorToolOutcome | null = null;
    if (input.tool) {
      outcome = applyDirectorTool({
        tool: input.tool,
        agenda,
        state: stateOf(events),
        candidateTurnTexts: candidateTurnTexts(events),
      });
      if (canStore && outcome.events.length > 0) {
        const drafts: NewInterviewEvent[] = outcome.events.map((d) => ({
          sessionId: session.id,
          attempt,
          kind: d.kind,
          blockId: d.blockId,
          payload: d.payload,
        }));
        events = [...events, ...appendInterviewEvents(drafts, workspaceId, nowIso)];
      }
    }

    // 3. At most one stage direction, recorded so its dedupe outlives this request.
    const state = stateOf(events);
    const directive = decideDirective({ agenda, state, currentAttempt: attempt, nowMs });
    if (directive && canStore) {
      appendInterviewEvents(
        [
          {
            sessionId: session.id,
            attempt,
            kind: "directive",
            blockId: directive.blockId,
            payload: { directiveId: directive.id, kind: directive.kind, text: directive.text },
          },
        ],
        workspaceId,
        nowIso,
      );
    }

    // The SAME ceiling `end_now` fires at (director.ts::endCeilingMin) — hard cap plus
    // the grace, or 2× the booking once the candidate agreed to the overrun. Two
    // definitions here would hang up a call the candidate had just bought time for.
    const overTime = agenda !== null && state.elapsedMs >= endCeilingMin(agenda, state) * 60_000;
    return {
      ok: true,
      ackSeq: maxInterviewTurnSeq(session.id, attempt, workspaceId),
      toolResult: outcome ? outcome.toolResult : null,
      directive,
      agenda: directorAgendaState(state),
      endCall: Boolean(outcome?.endCall) || state.endRequested || overTime,
      // Two numbers, no agenda content: how much live time has run and where the end
      // limit now sits — what the browser's fallback stop re-arms from.
      clock: agenda !== null ? { elapsedMs: state.elapsedMs, endLimitMs: endCeilingMin(agenda, state) * 60_000 } : null,
    };
  });
}
