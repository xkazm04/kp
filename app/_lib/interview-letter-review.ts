import type { PipelineEntry } from "./db/core";
import { getPipelineEntriesByIds } from "./db/pipeline";
import { interviewLetterQueue, type InterviewLetterRecord } from "./db/interview-letters";
import { consentWithholdsPii, maskCandidateName } from "./consent";
import type { LetterDraftSource, LetterState } from "./interview-letter-types";
import type { LetterOutcome } from "./interview-letter-policy";

// The RECRUITER's side of the interview feedback letter (spark interview-feedback-letter,
// WP-beta): the review queue the Decisions tab renders. The contract is
// app/_lib/interview-letter-types.ts, the store app/_lib/db/interview-letters.ts.
//
// Why a queue of its own: a decided candidate never reaches the ordinary Decisions queue
// (a reject clears `approval_kind`), so — like the Reconsider queue — this is the only list
// on which a person who asked for a letter can be found.
//
// Deliberately free of the comms dispatcher and the task hub (delivery lives in
// interview-letter-delivery.ts): the queue GET is read on every Decisions mount and every
// live-refresh, and must not compile the send path to answer "who is waiting".

/** Why a letter can only be CLOSED (declined), never written or sent. */
export type FeedbackLetterCloseOnly = "consent_withheld" | "application_gone";

/** One open letter as the recruiter's queue shows it. Operator-only. */
export type FeedbackLetterQueueItem = {
  id: string;
  /** The candidate's display label; masked when their consent is withheld, null when
   *  the application no longer exists (the client renders its own localized fallback). */
  candidateLabel: string | null;
  jobTitle: string | null;
  outcome: LetterOutcome;
  requestedAt: string;
  /** Open states only: the queue never lists a decided letter. */
  state: Extract<LetterState, "requested" | "drafted">;
  /** The letter's language, fixed when the candidate asked. */
  lang: string;
  /** The machine's draft and where it came from. Null before a draft exists — and
   *  withheld whenever the letter can only be closed: a draft is written ABOUT the
   *  person, and a lapsed consent withholds it at every read boundary (consent.ts). */
  draft: { text: string; source: LetterDraftSource; createdAt: string } | null;
  closeOnly: FeedbackLetterCloseOnly | null;
};

/** Why this letter can only be closed, or null when it can be reviewed and sent. The
 *  approve/redraft doors refuse on exactly this, so the queue and the doors agree. */
export function letterCloseOnly(entry: PipelineEntry | null, nowMs: number = Date.now()): FeedbackLetterCloseOnly | null {
  if (!entry) return "application_gone";
  const consent = { givenAt: entry.consentGivenAt, expiresAt: entry.consentExpiresAt, anonymizedAt: entry.anonymizedAt };
  return consentWithholdsPii(consent, nowMs) ? "consent_withheld" : null;
}

/** The queue projection of one letter. Pure: the entry is read by the caller. */
export function feedbackLetterQueueItem(
  letter: InterviewLetterRecord,
  entry: PipelineEntry | null,
  nowMs: number = Date.now()
): FeedbackLetterQueueItem {
  const closeOnly = letterCloseOnly(entry, nowMs);
  return {
    id: letter.id,
    candidateLabel: entry ? (closeOnly ? maskCandidateName(entry.candidateLabel) : entry.candidateLabel) : null,
    jobTitle: entry?.jobTitle ?? null,
    outcome: letter.outcome,
    requestedAt: letter.requestedAt,
    // interviewLetterQueue reads open letters only; narrowed here so the wire type says so.
    state: letter.state === "drafted" ? "drafted" : "requested",
    lang: letter.lang,
    draft: closeOnly ? null : letter.draft,
    closeOnly,
  };
}

/** The review queue: every open, non-erased letter in this team, OLDEST first (the store's
 *  order — the candidate who has waited longest is first). `truncated` says when more
 *  letters wait than the page carries, so a count is never silently short. */
export function feedbackLetterQueue(workspaceId: string, limit = 100, nowMs: number = Date.now()): { items: FeedbackLetterQueueItem[]; truncated: boolean } {
  // One past the page, so `truncated` is a fact rather than a guess.
  const letters = interviewLetterQueue(workspaceId, limit + 1);
  const page = letters.slice(0, limit);
  // One batched read for the whole page, never a SELECT per row (the reconsider queue's
  // decision-io-diet precedent): the queue reloads on every live-refresh.
  const entries = getPipelineEntriesByIds(
    page.map((l) => l.entryId),
    workspaceId
  );
  return {
    items: page.map((l) => feedbackLetterQueueItem(l, entries.get(l.entryId) ?? null, nowMs)),
    truncated: letters.length > limit,
  };
}
