import { NextResponse } from "next/server";
import { getJobPosting } from "@/app/_lib/db/job-postings";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// GET /api/job-postings/[id] — one imported posting, body included (the list
// projection deliberately omits it). Workspace-scoped point read: a leaked posting id
// never resolves another team's imported material.
export const GET = withWorkspace(async (ws: string, _request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const posting = getJobPosting(id, ws);
    if (!posting) return jsonRefusal("POSTING_NOT_FOUND", 404);
    return NextResponse.json({ posting });
  } catch (error) {
    return safeJsonError(error, "api:job-postings/[id]", "JOB_LOAD_FAILED");
  }
});
