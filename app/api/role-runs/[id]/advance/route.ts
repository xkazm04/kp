import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { getRoleRun } from "@/app/_lib/db/role-runs";
import { advanceRoleRunLive } from "@/app/_lib/role-run-live";

// POST /api/role-runs/[id]/advance - ADR-0011. Take one live pass over a run (resume after
// a gate was resolved, or after the LLM budget was raised). Same pass as the clock's
// `role_run_advance` job and as POST /api/role-runs; see role-run-live.ts.
//
// Parks at every human gate and at the run's LLM budget. A pass already running for this
// run answers 409 ROLE_RUN_BUSY rather than starting a second one.

// One budget with ../../route (start): both spend model calls.
const ADVANCE_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

export const POST = withWorkspace(async (ws: string, request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const { id } = await params;
    if (!getRoleRun(id, ws)) return jsonRefusal("ROLE_RUN_NOT_FOUND", 404);
    if (!rateLimit(`role-run-advance:${clientIpFrom(request.headers)}`, ADVANCE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const live = await advanceRoleRunLive(id, ws);
    if (live.outcome === "not_found") return jsonRefusal("ROLE_RUN_NOT_FOUND", 404);
    if (live.outcome === "busy") return jsonRefusal("ROLE_RUN_BUSY", 409);
    return NextResponse.json(live.result);
  } catch (error) {
    return safeJsonError(error, "api:role-runs/advance", "ROLE_RUN_ADVANCE_FAILED");
  }
});
