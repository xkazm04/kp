import { route } from "@/app/_lib/auth/workspace-context";
import { withOperator } from "@/app/_lib/auth/route-guards";
import { jsonOk, jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { MAX_ENTRY_ID_LEN } from "@/app/_lib/entries-param";
import { loadRoleDecisionView } from "@/app/_lib/role-decision-view-server";

// GET ?job=<jobId> -> the role decision view (CX S45, app/_lib/role-decision-view.ts):
// every ACTIVE candidate on the role with the match score and its provenance, the work
// sample's transfer score and how it was graded, the evidence ladder in summary and the
// interview scorecards. Absent parts are nulls with a reason code, never 0.
// Operator-gated + tenant-scoped like the rest of /api/decisions/*: every read in the
// loader carries the session's workspace, and a submission another team owns reads as
// absent. Read-only.
export const GET = route(withOperator)(async (ws: string, request: Request) => {
  const jobId = new URL(request.url).searchParams.get("job")?.trim() ?? "";
  if (!jobId || jobId.length > MAX_ENTRY_ID_LEN) return jsonRefusal("ROLE_VIEW_JOB_REQUIRED", 400);
  try {
    return jsonOk(loadRoleDecisionView(jobId, ws));
  } catch (error) {
    return safeJsonError(error, "api:decisions/role-view", "ROLE_VIEW_LOOKUP_FAILED");
  }
});
