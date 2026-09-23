import { NextResponse } from "next/server";
import { safeJsonError } from "@/app/_lib/api-response";
import { listPostings, listSubmissions } from "@/app/_lib/db/devcase";
import { latestOutcomeByRefs } from "@/app/_lib/dev-outcomes";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { activePromoteFloor } from "@/app/_lib/devcase-orchestrator";
import { promoteVerdict, promoteVerdictInputOf } from "@/app/_lib/devcase-promote-verdict";


// Postings (OUT) with their received submissions (IN) inlined, each carrying its latest
// recorded outcome from the dev-outcomes store (submission.id is the `ref` by contract).
// Without the join the outcome pill lived only in SubmissionRow state, so any remount
// re-offered the record buttons and a re-click double-counted in calibrate().
//
// TENANT SCOPE (D5): all three reads take the caller's workspace. The stores accepted it
// all along; the route simply never passed it, so every team's Dev studio listed the
// DEFAULT workspace's postings and submissions.
export async function GET() {
  try {
    const ws = await currentWorkspace();
    const postings = listPostings(ws).map((p) => ({ ...p, submissions: listSubmissions(p.id, ws) }));
    const outcomes = latestOutcomeByRefs(postings.flatMap((p) => p.submissions.map((s) => s.id)), ws);
    // The promote verdict each EVALUATED submission would land with, at the server's
    // calibrated floor - the same pure rule promoteSubmission writes - so the panel shows
    // advance-or-hold (and why) BEFORE the click. Unevaluated rows carry no key at all.
    const floor = activePromoteFloor();
    const merged = postings.map((p) => ({
      ...p,
      submissions: p.submissions.map((s) => {
        const outcome = outcomes.get(s.id);
        const withOutcome = outcome ? { ...s, outcome } : s;
        return s.evaluation
          ? { ...withOutcome, promotePreview: promoteVerdict(promoteVerdictInputOf(s.evaluation, s.transferScore, floor)) }
          : withOutcome;
      }),
    }));
    return NextResponse.json({ postings: merged });
  } catch (error) {
    return safeJsonError(error, "api:devcase/postings", "DEVCASE_POSTINGS_FAILED");
  }
}
