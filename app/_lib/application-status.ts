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
 *  a company-side close (`rejected`/`rematched`) → not_selected; a candidate-side
 *  decline (`declined`) → withdrawn; otherwise map the live stage (Hired with
 *  status='active' is the win). Unknown stage falls back to received — never throws. */
export function candidateStatusFor(entryStatus: string, stage: string): CandidateStatus {
  if (entryStatus === "rejected" || entryStatus === "rematched") return "not_selected";
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
