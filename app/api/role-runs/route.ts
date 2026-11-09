import { NextRequest, NextResponse } from "next/server";
import { withWorkspace } from "@/app/_lib/auth/workspace-context";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { jsonRefusal, requireCapabilityCoded, safeJsonError } from "@/app/_lib/api-response";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { getJob, jobVisibleToWorkspace } from "@/app/_lib/db/jobs";
import { getOrCreateRoleRun, listRoleRuns } from "@/app/_lib/db/role-runs";
import { advanceRoleRunLive } from "@/app/_lib/role-run-live";

// POST /api/role-runs - ADR-0011. Start (or resume) the role run for one job and take the
// first live pass: JD -> slate -> screening, stopping at the first human gate.
//
// Idempotent by (workspace, job, cycle): a second call returns the same run and advances
// it from where it stopped. The pass is the LIVE one (role-run-live.ts) - producers over the
// keyless floor - so it may call a model, and is therefore operator-gated with the
// `pipeline:write` capability and throttled. It can never resolve a gate or exceed the run's
// LLM budget; both are the engine's, not this route's.

// One budget for start AND advance (same key as ./[id]/advance): a run is started once and
// advanced a few times, and each pass can spend model calls.
const ADVANCE_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

export const POST = withWorkspace(async (ws: string, request: NextRequest) => {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  try {
    const body = (await request.json().catch(() => null)) as { jobId?: unknown; cycle?: unknown } | null;
    const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
    const cycle = typeof body?.cycle === "string" ? body.cycle.trim().slice(0, 40) : undefined;
    if (!jobId) return jsonRefusal("ROLE_RUN_START_INVALID", 400);
    if (!getJob(jobId, ws) || !jobVisibleToWorkspace(jobId, ws)) return jsonRefusal("ROLE_RUN_JOB_NOT_FOUND", 404);
    if (!rateLimit(`role-run-advance:${clientIpFrom(request.headers)}`, ADVANCE_RATE_LIMIT)) {
      return jsonRefusal("TOO_MANY_REQUESTS", 429);
    }
    const { run, created } = getOrCreateRoleRun({ jobId, cycle }, ws);
    const live = await advanceRoleRunLive(run.id, ws);
    if (live.outcome !== "advanced") return jsonRefusal("ROLE_RUN_BUSY", 409);
    return NextResponse.json({ created, ...live.result }, { status: created ? 201 : 200 });
  } catch (error) {
    return safeJsonError(error, "api:role-runs", "ROLE_RUN_ADVANCE_FAILED");
  }
});

// GET /api/role-runs?jobId= - the runs of one role, newest first, as ids and states only. How the
// job page finds the run it would otherwise have to START (a POST takes a live pass) just to
// learn its id. Read-only, no limiter, operator-gated; codes and refs only.
export const GET = withWorkspace(async (ws: string, request: NextRequest) => {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const jobId = request.nextUrl.searchParams.get("jobId")?.trim() ?? "";
    if (!jobId) return jsonRefusal("ROLE_RUN_START_INVALID", 400);
    const runs = listRoleRuns({ jobId }, ws).map((r) => ({ id: r.id, jobId: r.jobId, cycle: r.cycle, status: r.status, createdAt: r.createdAt }));
    return NextResponse.json({ runs });
  } catch (error) {
    return safeJsonError(error, "api:role-runs/list", "ROLE_RUN_GATE_FAILED");
  }
});
