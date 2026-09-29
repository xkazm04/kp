import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { getGig } from "@/app/_lib/db/gigs";
import { acceptGigPlan, getGigPlan } from "@/app/_lib/db/gigs-plans";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// POST /api/gigs/[id]/plans/[planId]/accept [{ note?: string }] - the operator accepts ONE
// plan for the gig (docs/features/gigs/README.md "Plans"). Only an accepted plan can be
// dispatched, and its steps become the goals of the gig's Personas milestone; the note
// (at most 2000 characters, optional) rides into the agent's assignment.
//
//   200 { plan }  - the accepted row (acceptedAt, note)
//   400 GIG_INPUT_INVALID { field: "note" } - not a string, or longer than 2000 characters
//   404 GIG_NOT_FOUND
//   404 GIG_PLAN_NOT_FOUND - no such plan in this workspace, OR a plan of another gig: the
//       path names the pair, and a plan id is never accepted through a gig it is not of
//   409 GIG_PLAN_ALREADY_ACCEPTED - this gig already has an accepted plan (one, ever); the
//       store's CAS under `.immediate()` (db/gigs-plans.ts acceptGigPlan) makes a second,
//       concurrent acceptance lose rather than land
//   409 GIG_ACTION_NOT_ALLOWED { reason: "not_ready" } - the seat has not written a plan
//       (queued, running or failed)
//   429 TOO_MANY_REQUESTS · 500 GIG_STORE_FAILED
//
// Throttled per IP before the body is read, like every /api/gigs write (open mode makes the
// operator gate a no-op). One row write per click, so the budget is the review desk's.

type Params = { params: Promise<{ id: string; planId: string }> };

/** The note's cap (db/gigs-plans.ts acceptGigPlan clamps to the same). */
const NOTE_MAX = 2000;

export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-plan-accept:${clientIpFrom(request.headers)}`, { limit: 60, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    // An absent or empty body accepts with no note.
    const body = (await request.json().catch(() => null)) as { note?: unknown } | null;
    const rawNote = body && typeof body === "object" ? body.note : undefined;
    if (rawNote !== undefined && rawNote !== null && (typeof rawNote !== "string" || rawNote.length > NOTE_MAX)) {
      return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "note" });
    }
    const note = typeof rawNote === "string" && rawNote.trim() ? rawNote : null;
    const { id, planId } = await params;
    const ws = await currentWorkspace();
    if (!getGig(ws, id)) return jsonRefusal("GIG_NOT_FOUND", 404);
    const plan = getGigPlan(ws, planId);
    if (!plan || plan.gigId !== id) return jsonRefusal("GIG_PLAN_NOT_FOUND", 404);
    const out = acceptGigPlan(ws, planId, note);
    if (out.ok) return NextResponse.json({ plan: out.plan });
    if (out.reason === "already_accepted") return jsonRefusal("GIG_PLAN_ALREADY_ACCEPTED", 409);
    if (out.reason === "not_ready") return jsonRefusal("GIG_ACTION_NOT_ALLOWED", 409, { reason: "not_ready" });
    return jsonRefusal("GIG_PLAN_NOT_FOUND", 404);
  } catch (error) {
    return safeJsonError(error, "api:gigs/[id]/plans/[planId]/accept", "GIG_STORE_FAILED");
  }
}
