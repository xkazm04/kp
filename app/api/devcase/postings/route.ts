import { NextResponse } from "next/server";
import { listPostings, listSubmissions } from "@/app/_lib/db/devcase";
import { latestOutcomeByRefs } from "@/app/_lib/dev-outcomes";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";


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
    const merged = postings.map((p) => ({
      ...p,
      submissions: p.submissions.map((s) => {
        const outcome = outcomes.get(s.id);
        return outcome ? { ...s, outcome } : s;
      }),
    }));
    return NextResponse.json({ postings: merged });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list postings." }, { status: 500 });
  }
}
