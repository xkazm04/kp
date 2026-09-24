import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { GIG_SCAN_TASK_KIND } from "@/app/_lib/gigs/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { startTask } from "@/app/_lib/tasks";

// POST /api/gigs/scan - the Gig desk's "scan now". Enqueues the `gig_scan` task for THIS
// workspace (tasks.ts delegates to the late-bound runner in late-bound-boot.ts: every
// enabled, unpaused gig source through its official API, then the deterministic
// qualifier) and answers 202 with the task id. The task's `ok` run is what lets the
// operator arm the twice-daily clock job (scheduler-jobs.ts requiresVerifiedRun).
//
// Not refused offline: KP_OFFLINE makes every source answer `offline` before any egress,
// and the summary says so.
//
// Throttled per IP: a scan is minutes of third-party API reads under the politeness
// budget the whole install shares, and the dedupe key (one gig scan per tenant in flight)
// already folds a double-click onto the running task.

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-scan:${clientIpFrom(request.headers)}`, { limit: 6, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const ws = await currentWorkspace();
    // workspaceId rides in params for the dedupe builder (task-dedupe.ts sees params only).
    const task = startTask(GIG_SCAN_TASK_KIND, { trigger: "manual", workspaceId: ws }, ws);
    return NextResponse.json({ taskId: task.id }, { status: 202 });
  } catch (error) {
    return safeJsonError(error, "api:gigs/scan", "GIG_STORE_FAILED");
  }
}
