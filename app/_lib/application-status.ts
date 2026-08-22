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
//
// Only correct for a workspace on the SHIPPED axis. A renamed column falls through
// to `received`, which would tell a candidate at the offer stage that we have
// merely received their CV — so callers that can resolve the stage's ROLE pass it
// and get STAGE_ROLE_TO_STATUS below instead.
const STAGE_TO_STATUS: Record<string, CandidateStatus> = {
  Accepted: "received",
  Screened: "under_review",
  Interview: "interview",
  Offer: "offer",
  Hired: "hired",
};

// The same projection keyed by stage ROLE — the axis-independent half. A custom
// column (`custom`) reads as "under review": the candidate is somewhere in the
// middle of a process whose internal name is none of their business, and
// "received" would understate where they actually stand.
//
// EXHAUSTIVE over StageRole on purpose (application-status.test.ts pins that, and
// that both maps agree on the shipped axis). A role with no entry here falls
// through to the NAME map, which only knows the shipped column names — so a
// workspace-composed column would read "received" to a candidate who is deep in
// the process. That is exactly what `scoring` did: it is not on the default axis
// but IS offered by the setup wizard and the Settings → Hiring composer
// (SETUP_STAGE_ROLES / pipelineAxisDraft), and its id is whatever the workspace
// typed, so it missed both maps. It reads "under review" for the same reason
// `custom` does — the candidate is mid-process, and neither "received" (which
// understates a finished AI interview) nor "interview" (which would overstate a
// scoring column placed BEFORE any interview round) is honest for every axis.
//
// The role strings are inlined for the same import-free reason as the map above;
// pipeline-stages.ts owns the vocabulary.
const STAGE_ROLE_TO_STATUS: Record<string, CandidateStatus> = {
  entry: "received",
  screening: "under_review",
  interview: "interview",
  scoring: "under_review",
  offer: "offer",
  terminal: "hired",
  custom: "under_review",
};

/** Project an entry's (status, stage) into the candidate-facing status:
 *  a company-side close (`rejected`/`rematched`/`role_closed`) → not_selected; a
 *  candidate-side decline (`declined`) → withdrawn; otherwise map the live stage (the
 *  terminal stage with status='active' is the win). `role_closed` (the role was
 *  filled/closed) reads as not_selected to the candidate — the role is no longer open to
 *  them, which is honest without implying a merit rejection.
 *
 *  `stageRole` is the stage's role on the workspace's own axis. Pass it whenever it can
 *  be resolved: without it a renamed column falls through to `received`, which would tell
 *  a candidate sitting at the offer stage that we have merely received their CV. The
 *  parameter is optional so the pure/legacy callers keep working, and the name map is the
 *  fallback for the shipped axis. Unknown either way → received; never throws. */
export function candidateStatusFor(entryStatus: string, stage: string, stageRole?: string | null): CandidateStatus {
  if (entryStatus === "rejected" || entryStatus === "rematched" || entryStatus === "role_closed") return "not_selected";
  if (entryStatus === "declined") return "withdrawn";
  if (stageRole && STAGE_ROLE_TO_STATUS[stageRole]) return STAGE_ROLE_TO_STATUS[stageRole];
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
