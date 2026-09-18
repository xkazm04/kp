// The RECRUITER's evidence projection of a directed AI interview (spark
// ai-interview-parity, WP4).
//
// `interview_events` is the director's append-only record: every turn, every tool call
// the interviewer model made, every stage direction, and the observations only the
// candidate's browser could make. All of it was invisible to the recruiter. This module
// turns that record into the ONE shape the evidence door serves and the transcript
// modal reads.
//
// Three rules it exists to hold:
//
//   1. INTEGRITY OBSERVATIONS ARE OBSERVATIONS. Focus departures, guardrails and answer
//      timing are projected as facts with their own provenance. Nothing here scores
//      them, ranks them, or derives a verdict from them (registry:
//      observed-process-is-supporting-not-load-bearing, never-infer-from-how-a-person-
//      sounds). There is deliberately no "integrity score" field to render.
//   2. NOT MEASURED IS NOT ZERO. A signal the call never produced is absent, and
//      `observed` says whether the call was directed at all — so a surface can say
//      "not measured" instead of printing a 0 that reads as an assertion about the
//      candidate. `preSilenceMs` / `durationMs` keep their `null`s for the same reason
//      (director-types: a provider that exposes no speech boundary yields null, never 0).
//   3. IT IS A PROJECTION, NOT THE ROW. The agenda's `competency` and its planned
//      `questions` are private brief material and never cross this boundary; a
//      recording's `file` never does either, because a path is not a fact a browser
//      needs. Tool bookkeeping (`callId`, `toolResult`) stays server-side.
//
// PURE: no DB, no clock, no randomness — the route reads the rows and hands them in,
// exactly like voice/director.ts, so the whole projection is a table a test can pin.

import { deriveDirectorState, type DirectorEvent } from "./voice/director";
import type {
  AgendaBlockKind,
  InterviewAgenda,
  InterviewEventKind,
  RecordingDeleteReason,
  RecordingMeta,
} from "./voice/director-types";

/** How many event rows one evidence read may return. A 30-minute directed call records
 *  a few hundred (a session stops storing at 4000), so this is a bound on the
 *  pathological case rather than a page size — but it IS a bound, it is stated on the
 *  wire as `limit`, and `truncated` says when it bit. The MOST RECENT rows are kept:
 *  the transcript itself is served whole by the sibling door, so what an over-long call
 *  loses here is block tagging on its oldest turns, which then read as off-agenda. */
export const EVIDENCE_EVENT_LIMIT = 1500;

/** One agenda block as the recruiter meets it: what it was for, what it was given, and
 *  what the record says happened in it. No competency, no planned questions. */
export type EvidenceBlock = {
  id: string;
  kind: AgendaBlockKind;
  /** Candidate-safe title, in the entry's language. */
  title: string;
  budgetMin: number;
  /** False for warm-up, role questions and closing — their turns never reach the
   *  scorer, which is exactly what "not assessed" means on the transcript. */
  scored: boolean;
  begun: boolean;
  covered: boolean;
  /** Live milliseconds this block held the floor, on the SERVER clock. */
  spentMs: number;
};

/** One recorded attempt, without the file name. `state` is what the playback door will
 *  actually do, so a surface never renders a control that 404s:
 *  - `available` — the door serves it;
 *  - `deleted`   — the row is the record of its deletion (the file is gone);
 *  - `expired`   — retention has run out; the door already refuses, swept or not. */
export type EvidenceRecording = {
  attempt: number;
  mime: string;
  bytes: number;
  partial: boolean;
  startedAt: string;
  endedAt: string | null;
  deletedAt: string | null;
  deleteReason: RecordingDeleteReason | null;
  state: "available" | "deleted" | "expired";
};

/** One projected event. Flat and mostly-optional on purpose: every surface reads the
 *  two or three fields its own kind carries, and a kind that grows a field later adds
 *  one optional here rather than a new union arm every consumer must handle.
 *
 *  What is NOT here: `callId` / `toolResult` (the model's bookkeeping), the directive's
 *  injected `text` (a stage direction is not evidence about the candidate), and
 *  anything from the private brief. */
export type EvidenceEvent = {
  kind: InterviewEventKind;
  attempt: number;
  /** Per-attempt turn number; null on every non-turn kind. */
  seq: number | null;
  blockId: string | null;
  /** When it happened — the browser's stamp for client-originated rows. */
  at: string;
  /** Milliseconds from the call's clock origin, measured on the SERVER clock only (the
   *  same rule the director's own arithmetic runs under). Null when unreadable. */
  offsetMs: number | null;
  // turn
  role?: "candidate" | "interviewer" | "system";
  text?: string;
  // topic_covered / topic_cover_rejected / guardrail
  quote?: string;
  reason?: string;
  guardrail?: string;
  /** Guardrail only: whether the quote is the candidate's own persisted words. An
   *  observation about the RECORD, never about the person. */
  verified?: boolean;
  // candidate_question
  question?: string;
  // directive
  directive?: string;
  // focus_lost / focus_returned
  during?: string;
  awayMs?: number;
  // answer_timing
  turnSeq?: number;
  preSilenceMs?: number | null;
  durationMs?: number | null;
  // end_requested
  endReason?: string;
  refused?: boolean;
};

/** How this provider measured `answer_timing`. The two are NOT the same quantity and
 *  must never be presented as one comparable number: OpenAI Realtime reports
 *  transcription speech boundaries, ElevenLabs reports voice-activity windows with
 *  hysteresis. Null when the call ran on neither (a legacy or undirected session). */
export type EvidenceTimingSource = "speech_boundaries" | "vad_windows";

export type InterviewEvidence = {
  sessionId: string;
  provider: string;
  status: string;
  attempts: number;
  /** Null when the call was never directed (a pre-director row, the lab, an agenda
   *  that failed to build). Every observation then reads "not measured". */
  agenda: { durationMin: number; hardCapMin: number; closeReserveMin: number; blocks: EvidenceBlock[] } | null;
  /** The call's clock origin (ISO) — every `offsetMs` is measured from it. */
  startedAt: string | null;
  /** Live milliseconds across every attempt, gaps excluded (deriveDirectorState). */
  elapsedMs: number;
  events: EvidenceEvent[];
  limit: number;
  truncated: boolean;
  recordings: EvidenceRecording[];
  /** True when this call left a director record at all. FALSE is the difference
   *  between "the candidate never left the tab" and "nobody was watching the tab". */
  observed: boolean;
  timingSource: EvidenceTimingSource | null;
};

// ---- helpers ----------------------------------------------------------------------

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** `null` and "absent" are DIFFERENT here: a stored `null` is the provider saying "I
 *  cannot measure this", and it must survive onto the wire as null rather than be
 *  dropped to undefined, which a reader would render as a missing field instead of an
 *  unmeasurable one. */
function nullableNum(v: unknown): number | null | undefined {
  if (v === null) return null;
  return num(v);
}

const TURN_ROLES = new Set(["candidate", "interviewer", "system"]);

/** The subset of an event row this module reads (structurally a subset of
 *  db/interview-events.ts InterviewEvent, so store rows pass straight in). */
export type EvidenceSourceEvent = {
  kind: InterviewEventKind;
  attempt: number;
  seq: number | null;
  blockId: string | null;
  payload: Record<string, unknown>;
  at: string;
  createdAt: string;
};

/** One row → its projection. `originMs` is the call's clock origin; pass NaN when there
 *  is none and every offset reads null. */
export function projectEvidenceEvent(e: EvidenceSourceEvent, originMs: number): EvidenceEvent {
  const created = Date.parse(e.createdAt);
  const out: EvidenceEvent = {
    kind: e.kind,
    attempt: e.attempt,
    seq: e.seq,
    blockId: e.blockId,
    at: e.at,
    offsetMs: Number.isFinite(created) && Number.isFinite(originMs) ? Math.max(0, created - originMs) : null,
  };
  const p = e.payload ?? {};
  switch (e.kind) {
    case "turn": {
      const role = str(p.role);
      if (role && TURN_ROLES.has(role)) out.role = role as EvidenceEvent["role"];
      const text = str(p.text);
      if (text !== undefined) out.text = text;
      break;
    }
    case "topic_covered": {
      const quote = str(p.quote);
      if (quote !== undefined) out.quote = quote;
      break;
    }
    case "topic_cover_rejected": {
      const quote = str(p.quote);
      if (quote !== undefined) out.quote = quote;
      const reason = str(p.reason);
      if (reason !== undefined) out.reason = reason;
      break;
    }
    case "guardrail": {
      const kind = str(p.kind);
      if (kind !== undefined) out.guardrail = kind;
      const quote = str(p.quote);
      if (quote !== undefined) out.quote = quote;
      if (typeof p.verified === "boolean") out.verified = p.verified;
      break;
    }
    case "candidate_question": {
      const question = str(p.question);
      if (question !== undefined) out.question = question;
      break;
    }
    case "directive": {
      // The KIND only. The directive's text is an instruction to the model, written to
      // steer a conversation — quoting it at a recruiter invites reading it as a
      // finding about the candidate, which it never is.
      const kind = str(p.kind);
      if (kind !== undefined) out.directive = kind;
      break;
    }
    case "focus_lost": {
      const during = str(p.during);
      if (during !== undefined) out.during = during;
      break;
    }
    case "focus_returned": {
      const awayMs = num(p.awayMs);
      if (awayMs !== undefined) out.awayMs = awayMs;
      break;
    }
    case "answer_timing": {
      const turnSeq = num(p.turnSeq);
      if (turnSeq !== undefined) out.turnSeq = turnSeq;
      const pre = nullableNum(p.preSilenceMs);
      if (pre !== undefined) out.preSilenceMs = pre;
      const dur = nullableNum(p.durationMs);
      if (dur !== undefined) out.durationMs = dur;
      break;
    }
    case "end_requested": {
      const reason = str(p.reason);
      if (reason !== undefined) out.endReason = reason;
      if (p.refused === true) out.refused = true;
      break;
    }
    default:
      // recording_started / resumed carry nothing a surface needs beyond kind+attempt.
      break;
  }
  return out;
}

/** Strip every verbatim word from a projection — what the consent gate leaves behind.
 *  The STRUCTURE survives (a guardrail happened, in this block, at this minute), the
 *  candidate's words do not. Same doctrine as redactTranscriptForConsent: withhold the
 *  verbatim synthesis, keep the fact that there was one. */
export function redactEvidenceEvent(e: EvidenceEvent): EvidenceEvent {
  const out = { ...e };
  delete out.text;
  delete out.quote;
  delete out.question;
  return out;
}

export type BuildEvidenceInput = {
  session: {
    id: string;
    provider: string;
    status: string;
    attempts: number;
    agenda: InterviewAgenda | null;
    startedAt: string | null;
    endedAt: string | null;
    recordings: RecordingMeta[];
  };
  /** The session's events in record order (oldest first). */
  events: readonly EvidenceSourceEvent[];
  /** True when the retention window has run out for this session's audio — the same
   *  predicate the playback door re-evaluates on every read. */
  retentionDue: boolean;
  /** True when consent has expired or the entry is anonymized: no verbatim words. */
  withholdVerbatim: boolean;
  limit?: number;
};

const TIMING_SOURCE: Record<string, EvidenceTimingSource> = {
  openai: "speech_boundaries",
  elevenlabs: "vad_windows",
};

/** The whole projection. Coverage is DERIVED by the director's own `deriveDirectorState`
 *  rather than re-counted here — the recruiter's view of "what was covered" and the
 *  live call's view are the same function, so they cannot disagree.
 *
 *  `nowMs` for that derivation is the call's END, not the wall clock: the director runs
 *  the current attempt to `now` because it is directing it, and reading a finished
 *  interview three days later must not report three days of elapsed time. */
export function buildInterviewEvidence(input: BuildEvidenceInput): InterviewEvidence {
  const { session, events, retentionDue, withholdVerbatim } = input;
  const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? EVIDENCE_EVENT_LIMIT), EVIDENCE_EVENT_LIMIT));
  const truncated = events.length > limit;
  const kept = truncated ? events.slice(events.length - limit) : events;

  // The clock origin: the first thing the server recorded, or the connect when that is
  // earlier. Taken over ALL events, not the kept slice, so truncation cannot slide
  // every offset forward.
  const stamps: number[] = [];
  for (const e of events) {
    const t = Date.parse(e.createdAt);
    if (Number.isFinite(t)) stamps.push(t);
  }
  const startedMs = session.startedAt ? Date.parse(session.startedAt) : NaN;
  if (Number.isFinite(startedMs)) stamps.push(startedMs);
  const originMs = stamps.length > 0 ? Math.min(...stamps) : NaN;

  // The call's end on the server clock: the session's own `endedAt` when it has one,
  // else the last thing recorded, else the origin (a call that recorded nothing).
  const endedMs = session.endedAt ? Date.parse(session.endedAt) : NaN;
  const lastMs = stamps.length > 0 ? Math.max(...stamps) : NaN;
  const nowMs = Number.isFinite(endedMs) ? endedMs : Number.isFinite(lastMs) ? lastMs : Number.isFinite(originMs) ? originMs : 0;

  const directorEvents: DirectorEvent[] = events.map((e) => ({
    kind: e.kind,
    attempt: e.attempt,
    seq: e.seq,
    blockId: e.blockId,
    payload: e.payload ?? {},
    createdAt: e.createdAt,
  }));
  const state = deriveDirectorState({
    agenda: session.agenda,
    events: directorEvents,
    currentAttempt: session.attempts,
    attemptStartedAtMs: Number.isFinite(originMs) ? originMs : null,
    nowMs,
  });

  const covered = new Set(state.coveredBlockIds);
  const begun = new Set(state.begunBlockIds);
  const agenda = session.agenda
    ? {
        durationMin: session.agenda.durationMin,
        hardCapMin: session.agenda.hardCapMin,
        closeReserveMin: session.agenda.closeReserveMin,
        blocks: (session.agenda.blocks ?? []).map(
          (b): EvidenceBlock => ({
            id: b.id,
            kind: b.kind,
            title: b.title,
            budgetMin: b.budgetMin,
            scored: b.scored,
            begun: begun.has(b.id),
            covered: covered.has(b.id),
            spentMs: state.spentMsByBlock[b.id] ?? 0,
          })
        ),
      }
    : null;

  const projected = kept.map((e) => {
    const p = projectEvidenceEvent(e, originMs);
    return withholdVerbatim ? redactEvidenceEvent(p) : p;
  });

  const recordings = (session.recordings ?? []).map(
    (m): EvidenceRecording => ({
      attempt: m.attempt,
      mime: m.mime,
      bytes: Number.isFinite(m.bytes) ? m.bytes : 0,
      partial: m.partial === true,
      startedAt: m.startedAt,
      endedAt: m.endedAt ?? null,
      deletedAt: m.deletedAt ?? null,
      deleteReason: m.deleteReason ?? null,
      state: m.deletedAt ? "deleted" : retentionDue ? "expired" : "available",
    })
  );

  return {
    sessionId: session.id,
    provider: session.provider,
    status: session.status,
    attempts: session.attempts,
    agenda,
    startedAt: Number.isFinite(originMs) ? new Date(originMs).toISOString() : null,
    elapsedMs: state.elapsedMs,
    events: projected,
    limit,
    truncated,
    recordings,
    observed: events.length > 0,
    timingSource: TIMING_SOURCE[session.provider] ?? null,
  };
}
