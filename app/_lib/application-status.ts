// Candidate-facing application status (idea-e76a6fb2). kp captures the application
// then goes dark — the candidate can't see where they stand without emailing the
// recruiter, the single biggest candidate-experience complaint in recruiting. The
// internal (entryStatus, stage) pair is projected here into a small, friendly enum
// the public /status/[token] page renders — NO internal ids, names, or scores ever
// cross to the candidate. Pure + injectable so the mapping is unit-testable.

export type CandidateStatus =
  | "received"
  | "under_review"
  | "interview"
  | "offer"
  | "hired"
  | "not_selected"
  | "withdrawn";

/** The happy-path trail shown as a progress timeline; terminal off-path states
 *  (not_selected / withdrawn) render on their own, not as a trail step. */
export const CANDIDATE_TIMELINE: readonly CandidateStatus[] = ["received", "under_review", "interview", "offer", "hired"];

// Keyed by the canonical PIPELINE_STAGES values. Inlined (not imported) so this
// module stays dependency-free and the mapping is exercisable by bare `node --test`
// — the same import-free discipline as interview-reminder-policy.ts / offer-policy.ts.
const STAGE_TO_STATUS: Record<string, CandidateStatus> = {
  Accepted: "received",
  Screened: "under_review",
  Interview: "interview",
  Offer: "offer",
  Hired: "hired",
};

/** Project an entry's (status, stage) into the candidate-facing status:
 *  a company-side close (`rejected`/`rematched`/`role_closed`) → not_selected; a
 *  candidate-side decline (`declined`) → withdrawn; otherwise map the live stage (Hired
 *  with status='active' is the win). `role_closed` (the role was filled/closed) reads as
 *  not_selected to the candidate — the role is no longer open to them, which is honest
 *  without implying a merit rejection. Unknown stage falls back to received — never throws. */
export function candidateStatusFor(entryStatus: string, stage: string): CandidateStatus {
  if (entryStatus === "rejected" || entryStatus === "rematched" || entryStatus === "role_closed") return "not_selected";
  if (entryStatus === "declined") return "withdrawn";
  return STAGE_TO_STATUS[stage] ?? "received";
}

/** Terminal candidate statuses have no further timeline progress. */
export function isTerminalCandidateStatus(s: CandidateStatus): boolean {
  return s === "hired" || s === "not_selected" || s === "withdrawn";
}

/** Index of a status in the happy-path trail, or -1 for the off-path terminals —
 *  drives which trail dots render as reached on the status page. */
export function timelineIndex(s: CandidateStatus): number {
  return CANDIDATE_TIMELINE.indexOf(s);
}

/** How a status-page load failed, from the candidate's point of view:
 *  - `invalid`   — the LINK is the problem (unknown/expired token). Permanent
 *                  and user-actionable; retrying the same URL is futile.
 *  - `retryable` — a transient fault (offline, 5xx, back-pressure). The same
 *                  request can succeed later, so offer a Retry. */
export type StatusFetchError = "invalid" | "retryable";

/**
 * Classify a failed `/api/status/[token]` load so the candidate gets an honest,
 * actionable message instead of one dead-end string for every failure
 * (bug-ui-scan-2026-07-09 #4). `status` is the HTTP status, or `null` when the
 * fetch threw before any response (offline / DNS / CORS).
 *
 * Mirrors {@link isRetryableApplyStatus}: no response, a 5xx, or 408/429 is
 * RETRYABLE; every other 4xx — notably the route's 404 for an unknown/expired
 * token — is a permanent, link-level problem the candidate must fix (or request a
 * fresh link), so it maps to `invalid`. Pure + tested (application-status.test.ts).
 */
export function classifyStatusError(status: number | null): StatusFetchError {
  if (status === null) return "retryable";
  if (status >= 500 || status === 408 || status === 429) return "retryable";
  return "invalid";
}
