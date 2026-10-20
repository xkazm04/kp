// What a dropped call does next, as a pure decision (challenge-r08
// voice-interview-components/B; resume-affordances, degrade-never-block-a-candidate).
//
// A directed call that DROPS before its closing block finalizes `failed` on purpose
// so a reconnect RESUMES it (voice/finalize-status.ts). The resume path exists on the
// server; what was missing is the redial, and the order it must happen in:
//
//   1. The record is saved FIRST. /connect refuses an `in_progress` session touched
//      in the last 30 minutes (INTERVIEW_ALREADY_LIVE), and a session whose /complete
//      never landed IS still in_progress — so a redial over an unsaved session walks
//      the candidate into "already running in another window" in their only tab.
//   2. Then a short, cancellable countdown, at most AUTO_REDIAL_BUDGET times per page.
//      Two automatic /connect calls fit inside the route's 6-per-10-minutes token
//      budget with room left for the candidate's own clicks.
//
// Only a resumable attempt of an interview the candidate already consented to is
// restored without asking. An undirected call has no agenda to resume (a restart
// starts over), so it stays the candidate's click.
//
// Browser-safe and dependency-free so node:test can pin it (VoiceInterview.tsx is
// not importable in a unit test).

import type { InterviewEnding, InterviewFinalStatus } from "@/app/_lib/voice/finalize-status";

/** The seconds a candidate gets to cancel an automatic redial. */
export const REDIAL_COUNTDOWN_SECONDS = 5;
/** Automatic redials per page. Reset by a completed ending. */
export const AUTO_REDIAL_BUDGET = 2;

/** Where the last transcript save stands.
 *  - `pending`: a POST is in flight — the session may still be in_progress.
 *  - `saved`: /complete accepted it; the session is no longer in_progress.
 *  - `failed`: transient (network, 5xx, 429); a retry can still land it.
 *  - `refused`: a permanent 4xx; a retry is refused identically forever. */
export type SaveState = "pending" | "saved" | "failed" | "refused";

/** A 4xx other than 429 cannot improve on retry (/complete's 400 / 403 / 404 / 409 /
 *  413). 429 is its throttle and explicitly temporary. `null` is a network error. */
export function isPermanentRefusal(status: number | null | undefined): boolean {
  return typeof status === "number" && status >= 400 && status < 500 && status !== 429;
}

/** The one save state everything reads: the reconnect plan, the Start precondition
 *  and the Retry banner. `refusedStatus` is the HTTP status of the last answer
 *  when it was a 4xx; ANY permanent one is a refusal, whether or not it carried
 *  `discardedTurns`. */
export function saveStateOf(s: {
  saved: boolean;
  discardedTurns: number;
  inFlight: boolean;
  refusedStatus?: number | null;
}): SaveState {
  if (s.inFlight) return "pending";
  if (s.saved) return "saved";
  if (s.discardedTurns > 0 || isPermanentRefusal(s.refusedStatus)) return "refused";
  return "failed";
}

export type ReconnectInput = {
  /** The call was being directed (connect returned an agenda): there is a resume. */
  directed: boolean;
  ending: InterviewEnding;
  finalStatus: InterviewFinalStatus;
  save: SaveState;
  /** Automatic redials already spent on this page. */
  autoUsed: number;
  online: boolean;
  /** The candidate cancelled the countdown. */
  cancelled: boolean;
  /** The call went live before it ended. A connect that never did (a mic denial,
   *  a provider refusal) has nothing to resume and would fail the same way again.
   *  Absent = it did. */
  reachedLive?: boolean;
};

export type ReconnectPlan =
  | { kind: "countdown"; seconds: number }
  | { kind: "save_first" }
  | { kind: "wait_online" }
  | { kind: "manual"; reason?: "budget" | "cancelled" }
  | { kind: "none" };

export function reconnectPlan(s: ReconnectInput): ReconnectPlan {
  // Decided or terminal endings: nothing to restore. A completed interview must
  // never be redialled (and /complete refuses a second completion anyway).
  if (s.finalStatus === "completed") return { kind: "none" };
  if (s.ending !== "drop") return { kind: "none" };
  // Another window's call on this link finished first, or the link refused the
  // record: a redial could only be refused too.
  if (s.save === "refused") return { kind: "none" };
  // A connect that never went live already shows its own error beside Start.
  if (s.reachedLive === false) return { kind: "none" };
  if (!s.directed) return { kind: "manual" };
  // The session is still in_progress server-side until the save lands.
  if (s.save !== "saved") return { kind: "save_first" };
  if (s.cancelled) return { kind: "manual", reason: "cancelled" };
  if (s.autoUsed >= AUTO_REDIAL_BUDGET) return { kind: "manual", reason: "budget" };
  if (!s.online) return { kind: "wait_online" };
  return { kind: "countdown", seconds: REDIAL_COUNTDOWN_SECONDS };
}

export type StartPrecondition =
  | { kind: "dial" }
  | { kind: "retry_save"; sessionId: string }
  | { kind: "wait_save" };

/** Asked by EVERY Start — the automatic redial and the candidate's click alike —
 *  before start() resets the previous attempt's ids: a dial over the page's own
 *  unsaved session is the self-inflicted INTERVIEW_ALREADY_LIVE lockout. */
export function startPrecondition(s: {
  prior: { sessionId: string; save: SaveState } | null;
}): StartPrecondition {
  if (!s.prior) return { kind: "dial" };
  if (s.prior.save === "failed") return { kind: "retry_save", sessionId: s.prior.sessionId };
  if (s.prior.save === "pending") return { kind: "wait_save" };
  return { kind: "dial" };
}
