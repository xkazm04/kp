import { NextResponse } from "next/server";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { getRoleRun, listStageArtifacts } from "@/app/_lib/db/role-runs";
import { buildRoleRunView } from "./view";

// GET /api/role-runs/[id] - ADR-0011, review 2026-10-23 delivery 2. Where a run stands: its
// state, its stage log and the candidate branches parked at each human gate, batched per gate.
//
// READ-ONLY and cheap: it reads the ledger and takes no pass, spends no model call, so it
// carries no limiter (like GET /api/roles/[jobId]/slate). Operator-gated, as a parked branch
// names entries. CODES AND REFS ONLY - see ./view.ts. A run id of another team is a 404,
// indistinguishable from one that does not exist.
export const GET = withWorkspace(async (ws: string, _request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const run = getRoleRun(id, ws);
    if (!run) return jsonRefusal("ROLE_RUN_NOT_FOUND", 404);
    return NextResponse.json(buildRoleRunView(run, listStageArtifacts(id, ws), ws));
  } catch (error) {
    return safeJsonError(error, "api:role-runs/get", "ROLE_RUN_GATE_FAILED");
  }
});
