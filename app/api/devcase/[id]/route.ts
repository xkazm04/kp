import { NextResponse } from "next/server";
import { getDevCase } from "@/app/_lib/db/devcase";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";

// The assignment detail reader's own read (challenge-r03 devcase-workspace/A).
//
// GET /api/devcase used to ship every case's full design - need, analysis, role, and
// the case with its cover probes - so the reader could open without a second fetch,
// which put up to 500 full designs on the wire to draw a table. The list is now a
// ledger projection and this door hands back ONE full record, on open.
//
// AUTHORITY: identity presence, the same `read` gate the list carries. TENANT: the id
// is globally unique, so getDevCase is a point read - but a case id is not an authority
// to read another team's design, so a record from any other workspace answers exactly
// what an unknown id answers (no existence oracle).
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const record = getDevCase(id);
    if (!record || record.workspaceId !== (await currentWorkspace())) {
      return jsonRefusal("DEVCASE_CASE_NOT_FOUND", 404);
    }
    return NextResponse.json({ case: record });
  } catch (error) {
    return safeJsonError(error, "api:devcase/[id]", "DEVCASE_CASE_LIST_FAILED");
  }
}
