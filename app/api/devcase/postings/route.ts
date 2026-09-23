import { NextResponse } from "next/server";
import { safeJsonError } from "@/app/_lib/api-response";
import { listPostings } from "@/app/_lib/db/devcase";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { postingsView } from "@/app/_lib/devcase-postings-view";


// Postings (OUT) with their received submissions (IN) inlined - outcome-joined,
// promote-previewed and carrying in-flight counts. The enrichment is
// app/_lib/devcase-postings-view.ts, shared with GET /api/devcase/[id]/channels (the
// assignment detail's own read), so the two answer the same posting identically.
//
// The Dev studio no longer reads this workspace-wide fold (challenge-r09
// devcase-lifecycle/A); it stays, unchanged in shape, for the e2e journeys that read
// submissions inlined (journey-one-thread, token-doors-axe).
//
// TENANT SCOPE (D5): every read takes the caller's workspace. The stores accepted it
// all along; the route simply never passed it, so every team's Dev studio listed the
// DEFAULT workspace's postings and submissions.
export async function GET() {
  try {
    const ws = await currentWorkspace();
    return NextResponse.json({ postings: postingsView(listPostings(ws), ws) });
  } catch (error) {
    return safeJsonError(error, "api:devcase/postings", "DEVCASE_POSTINGS_FAILED");
  }
}
