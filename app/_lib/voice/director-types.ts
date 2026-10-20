// The interview DIRECTOR's wire contract (spark ai-interview-parity).
//
// The provider's realtime model still runs each turn — sub-second speech-to-speech is
// the one thing a relay brain cannot match (docs/architecture/decisions, "provider
// brain + our director") — but the conversation is DIRECTED from our server: an agenda
// with stable block ids, tool calls the model makes to leave a record, and stage
// directions the director injects back. This file is every shape that crosses a
// boundary between the four parties to that loop:
//
//   server agenda builder (interview-agenda.ts)  ─┐
//   director policy + route (voice/director.ts,    ├─ read/write these types
//     /api/interview/director)                     │
//   browser transports + useDirector               │
//   recruiter evidence view                       ─┘
//
// Browser-safe: types plus the re-exported tool vocabulary, no server imports.
// Wire field names inside tool ARGUMENTS are snake_case (the model reads them);
// everything else is camelCase like the rest of the app's JSON.

import {
  DIRECTOR_TOOL_NAMES,
  END_REASONS,
  GUARDRAIL_KINDS,
  OVERRUN_ANSWERS,
} from "./director-tools.mjs";
// Type-only (erased at build): keeps this module free of runtime imports so the
// browser transports can keep importing it.
import type { KitWeight } from "../interview-kit-types";

export {
  DIRECTOR_NOTE_PREFIX,
  DIRECTOR_TOOL_DEFS,
  DIRECTOR_TOOL_NAMES,
  END_REASONS,
  GUARDRAIL_KINDS,
  MAX_EVIDENCE_QUOTE_CHARS,
  OVERRUN_ANSWERS,
} from "./director-tools.mjs";

// ---- agenda ---------------------------------------------------------------------

/** What an agenda block is for. `warmup`, `role_qa` and `close` are fixed blocks the
 *  agenda builder adds around the kit's topics; only `topic` (and `open`, when a kit
 *  has one) carries scored evidence. */
export const AGENDA_BLOCK_KINDS = ["warmup", "topic", "open", "role_qa", "close"] as const;
export type AgendaBlockKind = (typeof AGENDA_BLOCK_KINDS)[number];

export type AgendaBlock = {
  /** Stable within one session's agenda: "b0", "b1", … in agenda order. */
  id: string;
  kind: AgendaBlockKind;
  /** Candidate-safe title in the entry's language (the sidebar shows it). */
  title: string;
  /** Planned minutes for this block. */
  budgetMin: number;
  /** The competency this block gathers evidence for (a rubric axis key or the kit's
   *  free competency), or null for warm-up / role questions / closing. SERVER-SIDE:
   *  never on the candidate view. */
  competency: string | null;
  /** False for warm-up, role questions and closing — their turns never reach the
   *  scorer. */
  scored: boolean;
  /** The questions asked ALOUD in this block (candidate-safe by construction). */
  questions: string[];
  /** JOB-KIT ONLY (spark interview-kit-template), absent on every other agenda.
   *  The questions in `questions` the kit marks as REQUIRED, each with the kit
   *  question id so an overlay and the record can name one and the text so the
   *  record of an unasked must-ask reads as the question rather than as an opaque
   *  id. The DIRECTOR reads it: a must-ask is asked even when the clock has run out
   *  (voice/director.ts — outstandingMustAsks, the overrun request, the refusal of
   *  a premature `complete`, and the `must_ask_unasked` rows an ended call leaves).
   *  SERVER-SIDE: toCandidateAgendaView constructs its blocks from four fields and
   *  cannot carry it; the texts themselves already ride `questions`, which is aloud
   *  material, but the REQUIRED marker is the recruiter's, not the candidate's. */
  mustAsks?: { id: string; text: string }[];
  /** JOB-KIT ONLY. How much of the decision this competency carries (1–3). It
   *  ORDERS nothing by itself — the kit's own order is the agenda's order — and no
   *  total is ever computed from it: it is emphasis, rendered in the PRIVATE brief
   *  so the interviewer knows which block to protect (registry:
   *  per-question-time-budget-that-tightens — "mark it in the plan so the
   *  interviewer knows which one to protect"). Never on the candidate view and
   *  never in the candidate-safe listing. */
  weight?: KitWeight;
};

export type InterviewAgenda = {
  version: 1;
  /** Booked length, minutes. */
  durationMin: number;
  /** Coverage-first may overrun into slack up to here (round(durationMin * 1.2)). */
  hardCapMin: number;
  /** Minutes reserved at the end for the read-back and the candidate's questions. */
  closeReserveMin: number;
  blocks: AgendaBlock[];
};

/** The agenda as the candidate's browser receives it: no competencies, no questions. */
export type CandidateAgendaBlock = Pick<AgendaBlock, "id" | "kind" | "title" | "budgetMin">;
export type CandidateAgendaView = {
  durationMin: number;
  hardCapMin: number;
  blocks: CandidateAgendaBlock[];
};

// ---- tools ------------------------------------------------------------------------

export type DirectorToolName = (typeof DIRECTOR_TOOL_NAMES)[number];
export type GuardrailKind = (typeof GUARDRAIL_KINDS)[number];
export type EndReason = (typeof END_REASONS)[number];
/** The candidate's answer to the ONE overrun request, as the interviewer reports it. */
export type OverrunAnswer = (typeof OVERRUN_ANSWERS)[number];

/** A tool call as the model emits it — arguments keep their snake_case wire names. */
export type DirectorToolCall =
  | { name: "begin_topic"; args: { block_id: string } }
  | { name: "mark_topic_covered"; args: { block_id: string; evidence_quote: string } }
  | { name: "report_guardrail"; args: { kind: GuardrailKind; quote: string } }
  | { name: "forward_question"; args: { question: string } }
  | { name: "report_extra_time"; args: { answer: OverrunAnswer } }
  | { name: "end_interview"; args: { reason: EndReason } };

// ---- the director exchange ---------------------------------------------------------

/** One finalized turn, numbered per attempt so a retried POST is idempotent. */
export type DirectorTurn = {
  seq: number;
  role: "candidate" | "interviewer" | "system";
  text: string;
  /** ISO timestamp the browser stamped when the turn finalized. */
  at: string;
};

/** Observations only the browser can make. Never scored (registry:
 *  observed-process-is-supporting-not-load-bearing). */
export type DirectorClientEvent =
  | { kind: "focus_lost"; at: string; during: "candidate" | "interviewer" | "idle" }
  | { kind: "focus_returned"; at: string; awayMs: number }
  | {
      kind: "answer_timing";
      at: string;
      /** The candidate turn this timing belongs to. */
      turnSeq: number;
      /** Silence between the interviewer finishing and the candidate starting; null when
       *  the provider does not expose speech start/stop. */
      preSilenceMs: number | null;
      /** How long the candidate spoke; null when not measurable. */
      durationMs: number | null;
    };

export type DirectorRequest = {
  token: string;
  sessionId: string;
  /** interview_sessions.attempts at connect time. */
  attempt: number;
  /** Turns finalized since the last acknowledged seq (may be empty on a heartbeat). */
  turns: DirectorTurn[];
  events: DirectorClientEvent[];
  /** At most one tool call per request; the model is waiting on its result. */
  tool: { callId: string; name: string; args: unknown } | null;
};

/** `ask_overrun` (spark interview-kit-template) is the ONE request for extra time a
 *  kit's must-asks can trigger: the overrun is ASKED FOR, never taken silently. */
export const DIRECTIVE_KINDS = ["stay_narrow", "move_on", "close_now", "ask_overrun", "end_now", "resume"] as const;
export type DirectiveKind = (typeof DIRECTIVE_KINDS)[number];

/** A stage direction for the model. `text` is injected verbatim, prefixed with
 *  DIRECTOR_NOTE_PREFIX; it names blocks by id and candidate-safe title only, because
 *  it transits the candidate's browser. */
export type Directive = {
  id: string;
  kind: DirectiveKind;
  blockId: string | null;
  text: string;
};

export type DirectorAgendaState = {
  activeBlockId: string | null;
  coveredBlockIds: string[];
};

/** The director's clock as of this answer, for the browser's FALLBACK hard stop — the
 *  one rule that must still end the call if the director becomes unreachable. The
 *  connect-time arming only knows the agenda's `hardCapMin`; this is how it learns that
 *  the end limit MOVED (spark interview-kit-template: a candidate who agreed to finish a
 *  job kit's required questions bought time up to 2× the booking, and a browser still
 *  armed at hardCap + 2 would hang up on them).
 *
 *  Both values are LIVE time on the server clock (voice/director.ts deriveDirectorState:
 *  every attempt summed, the gaps between dropped attempts excluded), so the browser
 *  never has to reconcile its own clock with the server's — it only needs "how much
 *  live time is left", which is `endLimitMs − elapsedMs`. */
export type DirectorClock = {
  /** Live milliseconds of the call so far, every attempt included. */
  elapsedMs: number;
  /** The live-time point, in milliseconds, at which the director ends the call
   *  (voice/director.ts endCeilingMin): (hardCap + 2 min) normally, and 2× the booked
   *  length once the candidate AGREED to the must-ask overrun — never more, because
   *  2× booked is what the mint reserved and what the meter can bill. */
  endLimitMs: number;
};

export type DirectorResponse = {
  ok: true;
  /** Highest turn seq persisted for this attempt — the browser resends anything above. */
  ackSeq: number;
  /** The string handed back to the model for `tool`, or null when no tool was sent. */
  toolResult: string | null;
  directive: Directive | null;
  agenda: DirectorAgendaState;
  /** The browser must end the call once the interviewer's current utterance finishes. */
  endCall: boolean;
  /** The director's clock (see DirectorClock), or null for a call with no agenda —
   *  an undirected call has no end limit to report and no fallback stop to move. */
  clock: DirectorClock | null;
};

// ---- resume ------------------------------------------------------------------------

/** What a reconnect after a drop continues from. */
export type ResumeContext = {
  /** The attempt being resumed INTO (the new one). */
  attempt: number;
  /** Earlier attempts' turns, oldest first, capped to the most recent 40. */
  priorTurns: DirectorTurn[];
  activeBlockId: string | null;
  coveredBlockIds: string[];
  /** Live seconds already spent across earlier attempts. */
  elapsedSec: number;
};

// ---- recording ---------------------------------------------------------------------

/** `erasure` is the GDPR Art. 17 path (WP3): it is NOT `candidate_request`, which is
 *  the status page's "delete just my recording" control — one erases the whole
 *  candidate, the other only the audio, and a deletion record that cannot tell them
 *  apart cannot answer what was asked of it. */
export type RecordingDeleteReason = "retention" | "candidate_request" | "recruiter" | "erasure";

/** One recorded attempt (candidate microphone only), stored under the data dir. */
export type RecordingMeta = {
  attempt: number;
  /** File name relative to the workspace's recordings folder. */
  file: string;
  bytes: number;
  mime: string;
  startedAt: string;
  endedAt: string | null;
  /** True when an upload failed mid-call and the file is incomplete. */
  partial: boolean;
  deletedAt: string | null;
  deleteReason: RecordingDeleteReason | null;
  /** The highest chunk index APPENDED to this attempt's file, so a replayed upload is
   *  acknowledged instead of doubling the audio. OPTIONAL: a row written before the
   *  cursor existed parses unchanged, and its absence simply means "nothing to replay
   *  against yet". (WP3 addition to the contract — see the package report.) */
  lastChunk?: number;
};

// ---- the stored event vocabulary -------------------------------------------------------

/** Every kind interview_events may hold (append-only). */
export const INTERVIEW_EVENT_KINDS = [
  "turn",
  "topic_begun",
  "topic_covered",
  "topic_cover_rejected",
  "directive",
  "guardrail",
  "candidate_question",
  "focus_lost",
  "focus_returned",
  "answer_timing",
  "end_requested",
  "resumed",
  "recording_started",
  "recording_deleted",
  /** The candidate's answer to the overrun request (`payload.answer`: agreed |
   *  declined). Its absence after an `ask_overrun` directive means no answer ever
   *  reached the director — which closes the call exactly like a refusal. */
  "overrun_answered",
  /** A kit must-ask the record cannot show was asked, written once per outstanding
   *  question when the call ends (`payload.questionId`, `payload.question`). The
   *  recruiter's answer to "which required question went unasked". */
  "must_ask_unasked",
] as const;
export type InterviewEventKind = (typeof INTERVIEW_EVENT_KINDS)[number];
