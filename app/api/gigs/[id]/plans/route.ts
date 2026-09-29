import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { getGig } from "@/app/_lib/db/gigs";
import { getAcceptedGigPlan, listGigPlans } from "@/app/_lib/db/gigs-plans";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";
import { startTask } from "@/app/_lib/tasks";

// /api/gigs/[id]/plans - the gig's plan proposals (docs/features/gigs/README.md "Plans").
//
// GET  -> 200 { plans: GigPlanRow[] } - every seat's row of every round, newest round
//         first (db/gigs-plans.ts): queued | running | ready (with its plan) | failed (with
//         its reason), each with its cost as the CLI reported it (null = not reported) and
//         its wall time; the accepted one carries acceptedAt and the operator's note.
//         404 GIG_NOT_FOUND · 500 GIG_STORE_FAILED
//
// POST -> 202 { taskId } - enqueue a `gig_plans` task for THIS gig: the three seats
//         (gigs/plan-seats.ts) each write a plan in parallel (gigs/plans.ts, late-bound).
//         Poll the task, or this GET, for the rows.
//         404 GIG_NOT_FOUND
//         409 GIG_PLAN_ALREADY_ACCEPTED - a plan is accepted; a gig has one, ever
//         409 GIG_ACTION_NOT_ALLOWED { reason: "no_brief" } - the seats read the research
//             brief, so research the gig first (POST /api/gigs/[id]/research)
//         429 TOO_MANY_REQUESTS · 500 GIG_STORE_FAILED
//         The runner itself skips (and its task summary names) a gig flagged as a honeypot,
//         one that left the line, and one whose round is already in flight; the dedupe key
//         folds a double-click onto the task in flight.
//
// Throttled per IP BEFORE any read, on the bucket the bulk door (POST /api/gigs/plans)
// shares: every accepted POST spends three model calls, one of them at xhigh effort.
// Keyless is not refused here: every seat answers `no_provider` and its row says so.

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    if (!getGig(ws, id)) return jsonRefusal("GIG_NOT_FOUND", 404);
    return NextResponse.json({ plans: listGigPlans(ws, id) });
  } catch (error) {
    return safeJsonError(error, "api:gigs/[id]/plans", "GIG_STORE_FAILED");
  }
}

export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-plans:${clientIpFrom(request.headers)}`, { limit: 20, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const gig = getGig(ws, id);
    if (!gig) return jsonRefusal("GIG_NOT_FOUND", 404);
    if (getAcceptedGigPlan(ws, id)) return jsonRefusal("GIG_PLAN_ALREADY_ACCEPTED", 409);
    if (!gig.brief) return jsonRefusal("GIG_ACTION_NOT_ALLOWED", 409, { reason: "no_brief" });
    // workspaceId rides in params for the dedupe builder (task-dedupe.ts sees params only).
    const task = startTask("gig_plans", { workspaceId: ws, gigIds: [id] }, ws);
    return NextResponse.json({ taskId: task.id }, { status: 202 });
  } catch (error) {
    return safeJsonError(error, "api:gigs/[id]/plans", "GIG_STORE_FAILED");
  }
}
