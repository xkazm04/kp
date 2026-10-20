import { getGig, transitionGig } from "../../db/gigs";
import { createGigAttempt, listGigAttemptsForGig, transitionGigAttempt } from "../../db/gigs-attempts";
import { GIG_PROPOSAL_SPECIALIST_ID, type GigDeliverable } from "../types";
import { firstSentences, type GigProposalBody } from "./model";

// The proposal becomes the gig's DRAFT (the proposal track has no persona): kp writes the
// attempt itself, so the review desk (approve -> in_review "Ready to send", then mark sent)
// works unchanged. The attempt carries the proposal's cost (null when kp composed it), so the
// draft lint never reads "the run's cost was never reported" for a model-written one.
//
// Which gig gets what:
//   - `qualified`: CLAIM `qualified -> dispatched` (CAS, the serialization point a dispatch
//     uses too), create the attempt (`dispatched`, specialist GIG_PROPOSAL_SPECIALIST_ID, no
//     execution id: nothing ran outside kp), move it `dispatched -> drafted` WITH the
//     deliverable, then the gig `dispatched -> drafted`. A failure after the claim is
//     compensated (the attempt failed / discarded, the gig back to `qualified`): never a
//     half-move;
//   - `drafted` whose LATEST attempt is kp's own and still `drafted` or `revision_requested`
//     (a rewrite: the operator asked for a new proposal): a fresh kp attempt is drafted from
//     the new proposal, then the old one is `discarded` (a `revision_requested` one is already
//     terminal and stays). The gig stays `drafted`;
//   - anything else - a persona's draft from before the tracks split, a gig the operator
//     already approved (`in_review`) - keeps its attempt: only the file and the record change.
// The proposal's own record (db/gigs.ts proposal_json) is written before this and always stays.

/** The deliverable's `confidence` is REQUIRED by the schema but kp does not rate its own bid:
 *  a neutral constant, displayed (as the deliverable's own claim) and never used as a score. */
export const GIG_PROPOSAL_CONFIDENCE = 0.5;

/** The proposal as the attempt's deliverable. Pure. */
export function proposalDeliverable(body: GigProposalBody, file: string, disclosure: string): GigDeliverable {
  return {
    version: 1,
    summary: firstSentences(body.understanding, 2),
    draftText: body.message,
    artifacts: [{ kind: "file", ref: file, title: "Client proposal" }],
    evidence: [],
    disclosure,
    confidence: GIG_PROPOSAL_CONFIDENCE,
    questions: [],
  };
}

export type ProposalDraftResult =
  | { status: "drafted"; attemptId: string }
  /** A rewrite on a drafted gig: a fresh kp attempt replaced kp's previous one. */
  | { status: "redrafted"; attemptId: string; replaced: string }
  /** The gig keeps the draft it has (a persona's, or one the operator approved). */
  | { status: "kept"; gigStatus: string }
  /** Nothing written: `reason` is the gig's status or the CAS that lost. */
  | { status: "skipped"; reason: string };

type Log = (line: string, error?: unknown) => void;

/** A new kp attempt moved to `drafted` with the deliverable; null (and the attempt failed)
 *  when the move lost. */
function draftAttempt(workspaceId: string, gigId: string, deliverable: GigDeliverable, costUsd: number | null): { id: string } | { error: string } {
  const attempt = createGigAttempt(workspaceId, { gigId, specialistId: GIG_PROPOSAL_SPECIALIST_ID, revisionNote: null });
  if (!attempt) return { error: "attempt_not_created" };
  const drafted = transitionGigAttempt(workspaceId, attempt.id, { from: "dispatched", to: "drafted", patch: { deliverable, costUsd } });
  if (drafted.ok) return { id: attempt.id };
  transitionGigAttempt(workspaceId, attempt.id, { from: "dispatched", to: "failed", patch: { fallbackReason: "proposal_draft_failed" } });
  return { error: `attempt_${drafted.reason}` };
}

function firstDraft(workspaceId: string, gigId: string, deliverable: GigDeliverable, costUsd: number | null, log: Log): ProposalDraftResult {
  const claimed = transitionGig(workspaceId, gigId, { from: "qualified", to: "dispatched" });
  if (!claimed.ok) return { status: "skipped", reason: `claim_${claimed.reason}` };
  const made = draftAttempt(workspaceId, gigId, deliverable, costUsd);
  if ("error" in made) {
    transitionGig(workspaceId, gigId, { from: "dispatched", to: "qualified" });
    log(`${gigId}: the proposal draft was not written (${made.error}); the gig is qualified again`);
    return { status: "skipped", reason: made.error };
  }
  const moved = transitionGig(workspaceId, gigId, { from: "dispatched", to: "drafted" });
  if (!moved.ok) {
    // The gig moved while the attempt was written (withdrawn, expired): the draft must not
    // outlive it as a drafted attempt on a gig that is not drafted.
    transitionGigAttempt(workspaceId, made.id, { from: "drafted", to: "discarded" });
    log(`${gigId}: the gig moved while the proposal draft was written (${moved.reason}); the attempt is discarded`);
    return { status: "skipped", reason: `gig_${moved.reason}` };
  }
  return { status: "drafted", attemptId: made.id };
}

function redraft(workspaceId: string, gigId: string, previousId: string, previousStatus: string, deliverable: GigDeliverable, costUsd: number | null, log: Log): ProposalDraftResult {
  const made = draftAttempt(workspaceId, gigId, deliverable, costUsd);
  if ("error" in made) return { status: "skipped", reason: made.error };
  if (previousStatus === "drafted") {
    const retired = transitionGigAttempt(workspaceId, previousId, { from: "drafted", to: "discarded" });
    if (!retired.ok) {
      // The operator acted on the old draft meanwhile (approved it): that decision wins, and
      // the fresh attempt must not sit beside it.
      transitionGigAttempt(workspaceId, made.id, { from: "drafted", to: "discarded" });
      log(`${gigId}: the previous proposal draft moved during the rewrite (${retired.reason}); it is kept`);
      return { status: "kept", gigStatus: getGig(workspaceId, gigId)?.status ?? "unknown" };
    }
  }
  return { status: "redrafted", attemptId: made.id, replaced: previousId };
}

/** Write (or replace) the proposal's draft attempt - see the header. Never throws. */
export function writeProposalDraft(workspaceId: string, gigId: string, deliverable: GigDeliverable, costUsd: number | null, log: Log): ProposalDraftResult {
  try {
    const gig = getGig(workspaceId, gigId);
    if (!gig) return { status: "skipped", reason: "not_found" };
    if (gig.status === "qualified") return firstDraft(workspaceId, gigId, deliverable, costUsd, log);
    if (gig.status === "drafted") {
      const latest = listGigAttemptsForGig(workspaceId, gigId).at(-1);
      if (latest && latest.specialistId === GIG_PROPOSAL_SPECIALIST_ID && (latest.status === "drafted" || latest.status === "revision_requested")) {
        return redraft(workspaceId, gigId, latest.id, latest.status, deliverable, costUsd, log);
      }
      return { status: "kept", gigStatus: gig.status };
    }
    if (gig.status === "in_review") return { status: "kept", gigStatus: gig.status };
    return { status: "skipped", reason: gig.status };
  } catch (error) {
    log(`${gigId}: the proposal draft could not be written`, error);
    return { status: "skipped", reason: "store_error" };
  }
}
