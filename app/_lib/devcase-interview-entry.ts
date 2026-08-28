// ONE THREAD (gap 4) — the voice screen, reached from the assignment.
//
// THE SEAM THIS CLOSES. `POST /api/interview/create` mints a screen for a pipeline
// `entryId` and nothing else, and `buildGroundedInterview` reads its whole brief off
// that entry. A candidate who did the assignment therefore became interviewable only
// AFTER someone remembered to promote them — while the reviewer looking at their
// evaluation (DevEvalPanel / the interview kit) is holding a SUBMISSION id, not an
// entry id. Two evidence bundles about one person, joined by nothing the UI could act
// on. This module is that join, and the only thing the create door needed to learn.
//
// IT MINTS NOTHING ITSELF. Resolving an assignment candidate onto the board is
// `promoteSubmission`'s job and has been since d60fa012 — real `profiles` row, real
// job id, the person's own archetype, ambiguity mints rather than resolves. A second
// path that created an entry "just for the interview" would be exactly the minted
// identity that milestone removed, one layer over. So the order here is:
//
//   1. an entry already links this submission  → use it (the common case after promote);
//   2. no entry yet                            → PROMOTE, through the shared door the
//      manual button and the lifecycle orchestrator both call, with the same
//      calibrated floor — then use what it returns.
//
// Promote-on-demand is not a shortcut around the reviewer's decision: the promote
// writes the same `screening_review` card with the same advance/hold verdict it always
// does, so starting a screen from the assignment produces the identical audit trail as
// pressing Promote and then Create link. What it removes is the ORDERING requirement,
// which was never a product rule — only an artifact of which id each surface held.

import { getSubmission } from "./db/devcase";
import { findEntryByDevSubmission } from "./db/pipeline";
import { activePromoteFloor } from "./devcase-orchestrator";
import { promoteSubmission } from "./devcase-run";

export type SubmissionEntryResolution =
  | {
      ok: true;
      entryId: string;
      /** True when this call promoted the submission to get the entry, false when the
       *  entry already existed. Callers surface it (the create route echoes it) so a
       *  recruiter can tell that starting the screen also put the candidate on the
       *  board — a side effect they should never discover from the board alone. */
      promoted: boolean;
    }
  | { ok: false; reason: "not_found" | "not_evaluated" };

/** The pipeline entry to hang a voice screen off, for a dev-case submission.
 *
 *  `not_found` covers BOTH an unknown id and a submission belonging to another team,
 *  deliberately as one answer: distinguishing them would let a caller probe which
 *  submission ids exist on other tenants. Same shape and same reasoning as
 *  `/api/devcase/promote`'s ownership check, which this mirrors — a known id from
 *  another team must not be promotable, and promoting is precisely what this may do.
 *
 *  `not_evaluated` is the honest refusal for a submission with no evaluation yet:
 *  there is nothing to promote on, and the interview brief the screen would carry is
 *  built from the evaluation's own minted follow-ups. */
export function resolveEntryForSubmission(submissionId: string, workspaceId: string): SubmissionEntryResolution {
  const id = (submissionId ?? "").trim();
  if (!id) return { ok: false, reason: "not_found" };

  const sub = getSubmission(id);
  // getSubmission is a by-id point read on a globally-unique id, so ownership is
  // checked here — the same place the promote route checks it, for the same reason.
  if (!sub || sub.workspaceId !== workspaceId) return { ok: false, reason: "not_found" };

  const existing = findEntryByDevSubmission(id, workspaceId);
  if (existing) return { ok: true, entryId: existing.id, promoted: false };

  if (!sub.evaluation) return { ok: false, reason: "not_evaluated" };

  // The shared promote door — floor included, so the verdict this writes onto the
  // screening card cannot differ from the one the manual button would have written.
  const result = promoteSubmission(id, activePromoteFloor());
  // promoteSubmission returns null only for an unevaluated submission, which the
  // guard above already refused; treat a null here as the same honest refusal rather
  // than inventing an entry id.
  if (!result) return { ok: false, reason: "not_evaluated" };
  return { ok: true, entryId: result.entryId, promoted: true };
}
