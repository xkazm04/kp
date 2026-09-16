import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { SCAN_TASK_KIND } from "@/app/_lib/jobseeker/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { startTask } from "@/app/_lib/tasks";

// POST /api/jobseeker/scan — the manual "scan now" door (WP4c). Enqueues the
// `jobseeker_scan` task (app/_lib/tasks.ts) for THIS workspace and answers 202 with the
// task id; the task runs app/_lib/jobseeker/scan.ts and records the scheduler_runs row
// whose first `ok` is what lets the operator arm the clock job (JOBSEEKER_SCAN_UNVERIFIED).
//
// Not refused offline: KP_OFFLINE makes every source answer `offline` before any egress,
// but structuring and matching what is ALREADY stored is local work the seeker still
// wants — so the scan runs and the summary says which sources were offline.
//
// Operator-gated by the proxy AND re-verified here; open mode makes that a no-op, so the
// limiter is the real bound: 6/10min per IP — a scan is minutes of third-party fetching
// under a politeness budget the whole install shares, and the dedupe key (one scan per
// tenant in flight) already folds a double-click onto the running task.

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  if (!rateLimit(`jobseeker-scan:${clientIpFrom(request.headers)}`, { limit: 6, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const ws = await currentWorkspace();
    // workspaceId rides in params for the dedupe builder (task-dedupe.ts sees params only).
    const task = startTask(SCAN_TASK_KIND, { trigger: "manual", workspaceId: ws }, ws);
    return NextResponse.json({ taskId: task.id }, { status: 202 });
  } catch (error) {
    return safeJsonError(error, "api:jobseeker/scan", "JOBSEEKER_STORE_FAILED");
  }
}
