import { NextResponse } from "next/server";
import { listPostings, listSubmissions } from "@/app/_lib/db";
import { latestOutcomeByRefs } from "@/app/_lib/dev-outcomes";


// Postings (OUT) with their received submissions (IN) inlined, each carrying its latest
// recorded outcome from the dev-outcomes store (submission.id is the `ref` by contract).
// Without the join the outcome pill lived only in SubmissionRow state, so any remount
// re-offered the record buttons and a re-click double-counted in calibrate().
export async function GET() {
  try {
    const postings = listPostings().map((p) => ({ ...p, submissions: listSubmissions(p.id) }));
    const outcomes = latestOutcomeByRefs(postings.flatMap((p) => p.submissions.map((s) => s.id)));
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
