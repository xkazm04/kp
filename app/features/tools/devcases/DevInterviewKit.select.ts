// Which shortlist row the case-level interview kit exports. Default remains the
// transfer leader; every followup-bearing row is selectable so a held candidate
// does not have to be copied out of EvalPanel by hand.
import type { Submission } from "./DevTypes";

export function submissionsWithFollowups(submissions: Submission[]): Submission[] {
  return submissions.filter((s) => (s.evaluation?.followups?.questions?.length ?? 0) > 0);
}

/** `selectedId` wins when it is still in the list; otherwise the transfer leader
 *  (first row — callers pass a transfer-sorted list). */
export function pickKitSubmission(candidates: Submission[], selectedId: string | null | undefined): Submission | null {
  if (candidates.length === 0) return null;
  return candidates.find((s) => s.id === selectedId) ?? candidates[0];
}
