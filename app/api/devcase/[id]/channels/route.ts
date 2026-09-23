import { NextResponse } from "next/server";
import { getDevCase } from "@/app/_lib/db/devcase";
import { listCasePostings } from "@/app/_lib/db/devcase-case-postings";
import { postingsView } from "@/app/_lib/devcase-postings-view";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// The assignment detail's own postings read (challenge-r09 devcase-lifecycle/A): this
// case's channels, each with its status, its submissions inlined and enriched exactly as
// GET /api/devcase/postings enriches them (app/_lib/devcase-postings-view.ts).
//
// The detail used to receive the workspace's whole postings fold and filter it to one
// case in the browser; the rows are now scoped in SQL, to this case and the caller's
// workspace (listCasePostings).
//
// AUTHORITY + TENANT: the same gate and the same owner check as GET /api/devcase/[id] -
// a case from any other workspace answers exactly what an unknown id answers, byte for
// byte, so this door is no existence oracle the record door is not.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const ws = await currentWorkspace();
    const record = getDevCase(id);
    if (!record || record.workspaceId !== ws) {
      return jsonRefusal("DEVCASE_CASE_NOT_FOUND", 404);
    }
    return NextResponse.json({ postings: postingsView(listCasePostings(id, ws), ws) });
  } catch (error) {
    return safeJsonError(error, "api:devcase/[id]/channels", "DEVCASE_POSTINGS_FAILED");
  }
}
