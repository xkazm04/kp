import { NextRequest, NextResponse } from "next/server";
import { RoleRunGateNotParkedError } from "@/app/_lib/role-run-engine";
import { isRoleRunGate } from "@/app/_lib/role-run-gates";
import { previewRoleRunGate } from "@/app/_lib/role-run-gate-preview";
import { getRoleRun } from "@/app/_lib/db/role-runs";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// POST /api/role-runs/[id]/gate/preview — ADR-0011 §3. What the recruiter is asked to
// approve at one of the run's three human gates, for one parked candidate branch, and
// the token that signs EXACTLY that set.
//
// The subject set and policy version are derived on the server from the parked
// artifact; the body names only the gate and the branch. Read-only: nothing is spent,
// nothing is written. Operator-gated, as a gate names candidates.

// One budget for preview AND commit (same key as ../commit): a commit is always
// preceded by a preview, and a recruiter walking a slate of twenty stays far under it.
const GATE_RATE_LIMIT = { limit: 120, windowMs: 10 * 60_000 };

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const body = (await request.json().catch(() => null)) as { gate?: unknown; branchRef?: unknown } | null;
    const branchRef = typeof body?.branchRef === "string" ? body.branchRef.trim() : "";
    if (!isRoleRunGate(body?.gate) || !branchRef) return jsonRefusal("ROLE_RUN_GATE_INVALID", 400);
    if (!getRoleRun(id, ws)) return jsonRefusal("ROLE_RUN_NOT_FOUND", 404);
    if (!rateLimit(`role-run-gate:${clientIpFrom(request.headers)}`, GATE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const preview = previewRoleRunGate(id, body.gate, branchRef, ws);
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof RoleRunGateNotParkedError) return jsonRefusal("ROLE_RUN_GATE_NOT_PARKED", 409);
    return safeJsonError(error, "api:role-runs/gate/preview", "ROLE_RUN_GATE_FAILED");
  }
}
