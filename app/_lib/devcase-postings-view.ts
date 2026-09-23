// The postings view: what the Dev studio is served for a list of postings (challenge-r09
// devcase-lifecycle/A). ONE enrichment, answered identically by two routes:
//
//   - GET /api/devcase/postings          - every posting of the workspace (kept for the
//                                          e2e journeys that read submissions inlined);
//   - GET /api/devcase/[id]/channels     - one case's postings, the assignment detail's
//                                          own read.
//
// Each posting gets its received submissions (IN) inlined, each carrying its latest
// recorded outcome from the dev-outcomes store (submission.id is the `ref` by contract).
// Without the join the outcome pill lived only in SubmissionRow state, so any remount
// re-offered the record buttons and a re-click double-counted in calibrate().
//
// Every read takes the caller's workspace (D5).
import { listSubmissions, type DevSubmission } from "@/app/_lib/db/devcase";
import { inFlightAttemptsByPosting, NO_IN_FLIGHT, type InFlightAttempts } from "@/app/_lib/db/devcase-inflight";
import { latestOutcomeByRefs, type OutcomeSummary } from "@/app/_lib/dev-outcomes";
import { activePromoteFloor } from "@/app/_lib/devcase-orchestrator";
import { promoteVerdict, promoteVerdictInputOf, type PromoteVerdict } from "@/app/_lib/devcase-promote-verdict";

export type ViewSubmission = DevSubmission & { outcome?: OutcomeSummary; promotePreview?: PromoteVerdict };
export type PostingView<P> = P & { inFlight: InFlightAttempts; submissions: ViewSubmission[] };

export function postingsView<P extends { id: string }>(postings: readonly P[], workspaceId: string): Array<PostingView<P>> {
  if (postings.length === 0) return [];
  // The per-posting read is deliberately unbounded (a case's cohort must be whole); the
  // caller bounds the POSTINGS - one case's channels, or the workspace route's list.
  const withSubs = postings.map((p) => ({ ...p, submissions: listSubmissions(p.id, workspaceId) }));
  const outcomes = latestOutcomeByRefs(withSubs.flatMap((p) => p.submissions.map((s) => s.id)), workspaceId);
  // The promote verdict each EVALUATED submission would land with, at the server's
  // calibrated floor - the same pure rule promoteSubmission writes - so the panel shows
  // advance-or-hold (and why) BEFORE the click. Unevaluated rows carry no key at all.
  const floor = activePromoteFloor();
  // Who is mid-case on each posting right now (challenge-r06 devcase-session-api/B):
  // COUNTS and the oldest live start, never a session id or ref, so the close confirm
  // can say how many attempts it would cut off. Zeros, not an absent key, when none.
  const inFlight = inFlightAttemptsByPosting(workspaceId);
  return withSubs.map((p) => ({
    ...p,
    inFlight: inFlight.get(p.id) ?? NO_IN_FLIGHT,
    submissions: p.submissions.map((s): ViewSubmission => {
      const outcome = outcomes.get(s.id);
      const withOutcome = outcome ? { ...s, outcome } : s;
      return s.evaluation
        ? { ...withOutcome, promotePreview: promoteVerdict(promoteVerdictInputOf(s.evaluation, s.transferScore, floor)) }
        : withOutcome;
    }),
  }));
}
