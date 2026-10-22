import { route } from "@/app/_lib/auth/workspace-context";
import { withOperator } from "@/app/_lib/auth/route-guards";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { humanActor } from "@/app/_lib/auth/operator-approver";
import { jsonOk, jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { MAX_ENTRY_ID_LEN } from "@/app/_lib/entries-param";
import { isShortlistState, listRoleShortlist, setShortlistState } from "@/app/_lib/db/role-shortlist";

// The role shortlist (ADR 0030, triage T14). GET ?job=<jobId> -> every marked person on the
// role: { rows: [{ entryId, state, setBy, setAt }] }. POST { job, entryId, state } sets one
// person's mark ("shortlisted" | "chosen") or clears it (state null).
//
// HUMAN-SET ONLY: this is the only writer. The actor is derived from the signed-in session
// (humanActor), never from the body, and the door needs the recruiter seat (pipeline:write).
// Tenant-scoped through the workspace the chain hands in; an entry another team owns, or one
// that is not on the named role, answers SHORTLIST_ENTRY_UNKNOWN and changes nothing.
export const GET = route(withOperator)(async (ws: string, request: Request) => {
  const denied = await requireOperator();
  if (denied) return denied;
  const jobId = new URL(request.url).searchParams.get("job")?.trim() ?? "";
  if (!jobId || jobId.length > MAX_ENTRY_ID_LEN) return jsonRefusal("ROLE_VIEW_JOB_REQUIRED", 400);
  try {
    return jsonOk({ rows: listRoleShortlist(ws, jobId) });
  } catch (error) {
    return safeJsonError(error, "api:decisions/shortlist", "SHORTLIST_READ_FAILED");
  }
});

export const POST = route(withOperator)(async (ws: string, request: Request) => {
  const unauthorized = await requireOperator();
  if (unauthorized) return unauthorized;
  const denied = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { job?: unknown; entryId?: unknown; state?: unknown } | null;
  const job = typeof body?.job === "string" ? body.job.trim() : "";
  const entryId = typeof body?.entryId === "string" ? body.entryId.trim() : "";
  const state = body?.state;
  const idOk = (v: string) => v.length > 0 && v.length <= MAX_ENTRY_ID_LEN;
  if (!idOk(job) || !idOk(entryId) || !(state === null || isShortlistState(state))) return jsonRefusal("SHORTLIST_REQUEST_INVALID", 400);
  try {
    const result = setShortlistState({ workspaceId: ws, jobId: job, entryId, state, actor: await humanActor() });
    if (!result.ok) return jsonRefusal("SHORTLIST_ENTRY_UNKNOWN", 404);
    return jsonOk({ row: result.row });
  } catch (error) {
    return safeJsonError(error, "api:decisions/shortlist", "SHORTLIST_SAVE_FAILED");
  }
});
