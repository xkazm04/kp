import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { getGigSource } from "@/app/_lib/db/gigs-sources";
import { GIG_SCAN_TASK_KIND } from "@/app/_lib/gigs/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { startTask } from "@/app/_lib/tasks";

// POST /api/gigs/scan [{ sourceId? }] - the Gig desk's "scan now". Enqueues the `gig_scan`
// task for THIS workspace (tasks.ts delegates to the late-bound runner in
// late-bound-boot.ts: every enabled, unpaused gig source through its official API, then
// the deterministic qualifier, then research for gigs with no brief) and answers 202 with
// the task id. The task's `ok` run is what lets the operator arm the twice-daily clock job
// (scheduler-jobs.ts requiresVerifiedRun) - a single-source run counts exactly as the
// whole-workspace run does under that rule (a source ran and the run completed); the rule
// itself is tasks.ts's and is not widened here.
//
// With `{ sourceId }` the task runs ONLY that source (the Sources screen's per-source
// button). The source is checked before anything is enqueued:
//   404 GIG_SOURCE_NOT_FOUND  - not a source of this workspace
//   409 GIG_ACTION_NOT_ALLOWED { reason: <pausedReason> | "disabled" } - the scan never
//       un-pauses and never enables; lifting a pause is the operator's PATCH
//   400 GIG_INPUT_INVALID { field: "sourceId" } - present but not a non-empty string
// No body (or `{}`) keeps the whole-workspace scan every existing caller sends.
//
// Not refused offline: KP_OFFLINE makes every source answer `offline` before any egress,
// and the summary says so.
//
// Throttled per IP: a scan is minutes of third-party API reads under the politeness
// budget the whole install shares, and the dedupe key (one gig scan per tenant in flight,
// one per SOURCE for a single-source scan) already folds a double-click onto the running
// task.

const SOURCE_ID_MAX = 200;

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-scan:${clientIpFrom(request.headers)}`, { limit: 6, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    // An absent or empty body is the whole-workspace scan; only a present `sourceId` narrows.
    const body = (await request.json().catch(() => null)) as { sourceId?: unknown } | null;
    const rawSource = body && typeof body === "object" ? body.sourceId : undefined;
    if (rawSource !== undefined && rawSource !== null && (typeof rawSource !== "string" || !rawSource.trim() || rawSource.length > SOURCE_ID_MAX)) {
      return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "sourceId" });
    }
    const ws = await currentWorkspace();
    const sourceId = typeof rawSource === "string" ? rawSource.trim() : null;
    if (sourceId) {
      const source = getGigSource(ws, sourceId);
      if (!source) return jsonRefusal("GIG_SOURCE_NOT_FOUND", 404);
      if (source.pausedReason !== null || !source.enabled) {
        return jsonRefusal("GIG_ACTION_NOT_ALLOWED", 409, { reason: source.pausedReason ?? "disabled" });
      }
    }
    // workspaceId (and sourceId) ride in params for the dedupe builder (task-dedupe.ts
    // sees params only).
    const params: Record<string, unknown> = { trigger: "manual", workspaceId: ws };
    if (sourceId) params.sourceId = sourceId;
    const task = startTask(GIG_SCAN_TASK_KIND, params, ws);
    return NextResponse.json({ taskId: task.id }, { status: 202 });
  } catch (error) {
    return safeJsonError(error, "api:gigs/scan", "GIG_STORE_FAILED");
  }
}
