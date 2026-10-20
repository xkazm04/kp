// The director EXCHANGE kernel (spark ai-interview-parity; ADR 0010) — the one
// algorithm behind every director response, over a small event-store PORT so that the
// live route and the interview simulator run the same code:
//
//   - voice/director-step.ts wraps it in ONE IMMEDIATE transaction with a store over
//     interview_events (the per-session ceiling, ON CONFLICT turn idempotency,
//     maxInterviewTurnSeq);
//   - interview-sim/director-loop.ts wraps it with an array store holding the same
//     rules in memory.
//
// The ORDER is the algorithm, because it decides what the director sees:
//
//   1. persist what the browser observed — the exchange's turns and its client
//      observations, each TAGGED with the block active BEFORE this exchange's tool;
//   2. apply AT MOST ONE tool call (director.ts applyDirectorTool) against the state
//      derived from the record so far and the candidate's persisted words, and persist
//      the events it asks for;
//   3. re-derive the state, decide AT MOST ONE stage direction (decideDirective) and
//      persist it, so its dedupe window survives across exchanges;
//   4. answer: the tool result, the directive, and
//      `endCall = outcome.endCall || state.endRequested || overTime`, with overTime
//      read against the SAME endCeilingMin `end_now` fires at, from the state as it
//      stood BEFORE the directive was appended.
//
// Past the store's ceiling (canStore false) nothing is written and the director still
// answers. Synchronous by construction and free of any DB import: the caller owns the
// transaction, and nothing here may await inside it.

import {
  applyDirectorTool,
  decideDirective,
  deriveDirectorState,
  directorAgendaState,
  endCeilingMin,
  type DirectorEvent,
  type DirectorEventDraft,
  type DirectorState,
  type DirectorToolCallInput,
  type DirectorToolOutcome,
} from "./director";
import type { DirectorClientEvent, DirectorResponse, DirectorTurn, InterviewAgenda } from "./director-types";

/** A browser timestamp older than this (or in the server's future) is replaced by the
 *  server's record time. */
const MAX_CLIENT_LAG_MS = 6 * 60 * 60_000;

/** A browser timestamp, kept when plausible; otherwise the server's record time. */
export function clampClientAt(at: string, nowMs: number): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t) || t > nowMs || t < nowMs - MAX_CLIENT_LAG_MS) return new Date(nowMs).toISOString();
  return new Date(t).toISOString();
}

/** A row the kernel asks its store to append (the store adds session, attempt and the
 *  record time). `seq` only on turns; `at` only on browser-originated rows. */
export type DirectorEventRow = DirectorEventDraft & { seq?: number | null; at?: string };

/** Where one call's director record lives. */
export type DirectorEventStore = {
  /** The call's events in record order, as they stand when the exchange begins. */
  events(): readonly DirectorEvent[];
  /** False once the per-session ceiling is reached: nothing more is written. */
  canStore(): boolean;
  /** Append in order; return the rows actually written (a turn already recorded for
   *  its attempt + seq is absorbed and NOT returned). */
  append(rows: readonly DirectorEventRow[], nowMs: number): readonly DirectorEvent[];
  /** Highest turn seq recorded for the current attempt, or -1. */
  maxTurnSeq(): number;
};

export type DirectorExchangeInput = {
  agenda: InterviewAgenda | null;
  /** The attempt being directed now. */
  attempt: number;
  /** When the current attempt connected, if known. */
  attemptStartedAtMs: number | null;
  nowMs: number;
  /** Already validated and clamped (director-step.ts parseDirectorTurns). */
  turns: readonly DirectorTurn[];
  /** Already validated (director-step.ts parseDirectorClientEvents). */
  clientEvents: readonly DirectorClientEvent[];
  tool: DirectorToolCallInput | null;
  store: DirectorEventStore;
};

export type DirectorExchangeResult = {
  /** The wire projection — exactly what the live route answers. */
  response: DirectorResponse;
  /** The tool outcome (events included), or null when no tool was sent. */
  outcome: DirectorToolOutcome | null;
  /** The state the directive was decided from. */
  state: DirectorState;
};

function candidateTurnTexts(events: readonly DirectorEvent[]): string[] {
  return events
    .filter((e) => e.kind === "turn" && e.payload.role === "candidate" && typeof e.payload.text === "string")
    .map((e) => e.payload.text as string);
}

/** Run one director exchange against `store`. Synchronous. */
export function directorExchange(input: DirectorExchangeInput): DirectorExchangeResult {
  const { agenda, attempt, attemptStartedAtMs, nowMs, store } = input;
  const stateOf = (events: readonly DirectorEvent[]) =>
    deriveDirectorState({ agenda, events, currentAttempt: attempt, attemptStartedAtMs, nowMs });

  let events: readonly DirectorEvent[] = store.events();
  const before = stateOf(events);
  // Past the per-session ceiling nothing more is stored — the director still answers.
  const canStore = store.canStore();

  // 1. Persist what the browser observed — turns tagged with the block they fell in.
  if (canStore) {
    const rows: DirectorEventRow[] = [];
    for (const t of input.turns) {
      rows.push({
        seq: t.seq,
        kind: "turn",
        blockId: before.activeBlockId,
        payload: { role: t.role, text: t.text },
        at: clampClientAt(t.at, nowMs),
      });
    }
    for (const e of input.clientEvents) {
      const { kind, at, ...fields } = e;
      rows.push({ kind, blockId: before.activeBlockId, payload: fields, at: clampClientAt(at, nowMs) });
    }
    if (rows.length > 0) events = [...events, ...store.append(rows, nowMs)];
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
      events = [...events, ...store.append(outcome.events, nowMs)];
    }
  }

  // 3. At most one stage direction, recorded so its dedupe outlives this exchange.
  const state = stateOf(events);
  const directive = decideDirective({ agenda, state, currentAttempt: attempt, nowMs });
  if (directive && canStore) {
    store.append(
      [{ kind: "directive", blockId: directive.blockId, payload: { directiveId: directive.id, kind: directive.kind, text: directive.text } }],
      nowMs,
    );
  }

  // 4. The answer. The SAME ceiling `end_now` fires at (director.ts::endCeilingMin) —
  // hard cap plus the grace, or 2× the booking once the candidate agreed to the
  // overrun. Two definitions here would hang up a call the candidate had just bought
  // time for.
  const overTime = agenda !== null && state.elapsedMs >= endCeilingMin(agenda, state) * 60_000;
  return {
    response: {
      ok: true,
      ackSeq: store.maxTurnSeq(),
      toolResult: outcome ? outcome.toolResult : null,
      directive,
      agenda: directorAgendaState(state),
      endCall: Boolean(outcome?.endCall) || state.endRequested || overTime,
      // Two numbers, no agenda content: how much live time has run and where the end
      // limit now sits — what the browser's fallback stop re-arms from.
      clock: agenda !== null ? { elapsedMs: state.elapsedMs, endLimitMs: endCeilingMin(agenda, state) * 60_000 } : null,
    },
    outcome,
    state,
  };
}
