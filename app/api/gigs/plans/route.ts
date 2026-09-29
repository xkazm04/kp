import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { startTask } from "@/app/_lib/tasks";

// POST /api/gigs/plans { gigIds: string[] } - propose plans for a SELECTION of gigs at once
// (docs/features/gigs/README.md "Plans"). One `gig_plans` task for the whole selection
// (gigs/plans.ts, late-bound): gigs one after another, each gig's three seats in parallel.
// A selection that does not fit one pass continues as a new task, whose id the first
// task's result names (`continuedAs`), so fifty gigs are never cut off by the task clock.
//
//   202 { taskId, queued } - `queued` is how many gigs the task was handed. The task's
//       summary says, per gig, which it skipped and why (not this workspace's, already
//       accepted, no brief yet, flagged as a honeypot, left the line, a round in flight):
//       the door does not pre-read fifty gigs to refuse a selection the runner can sort.
//   400 GIG_INPUT_INVALID { field: "gigIds" } - not an array of 1..50 unique non-empty ids
//   429 TOO_MANY_REQUESTS · 500 GIG_STORE_FAILED
//
// Throttled per IP BEFORE the body is read, on the bucket the one-gig door
// (POST /api/gigs/[id]/plans) shares. The dedupe key folds a repeat of the same selection
// onto the task in flight.

/** The most gigs one request may name (gigs/plans.ts GIG_PLANS_MAX_GIGS, restated so this
 *  door does not import the runner's spawn graph). */
const MAX_GIGS = 50;
const ID_MAX = 200;

export async function POST(request: Request): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-plans:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const body = (await request.json().catch(() => null)) as { gigIds?: unknown } | null;
    const raw = body && typeof body === "object" ? body.gigIds : undefined;
    const valid =
      Array.isArray(raw) &&
      raw.length >= 1 &&
      raw.length <= MAX_GIGS &&
      raw.every((id) => typeof id === "string" && id.trim() !== "" && id.length <= ID_MAX) &&
      new Set(raw).size === raw.length;
    if (!valid) return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "gigIds" });
    const gigIds = raw as string[];
    const ws = await currentWorkspace();
    // workspaceId rides in params for the dedupe builder (task-dedupe.ts sees params only).
    const task = startTask("gig_plans", { workspaceId: ws, gigIds }, ws);
    return NextResponse.json({ taskId: task.id, queued: gigIds.length }, { status: 202 });
  } catch (error) {
    return safeJsonError(error, "api:gigs/plans", "GIG_STORE_FAILED");
  }
}
