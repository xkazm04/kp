import { NextResponse } from "next/server";
import { jsonRefusal, safeJsonError, requireCapabilityCoded } from "@/app/_lib/api-response";
import { currentWorkspace } from "@/app/_lib/auth/current-workspace";
import { requireOperator } from "@/app/_lib/auth/require-operator";
import { requireCapability } from "@/app/_lib/auth/current-user";
import { clearGigSuspect, getGig, transitionGig } from "@/app/_lib/db/gigs";
import { listGigAttemptsForGig, transitionGigAttempt } from "@/app/_lib/db/gigs-attempts";
import { listOutcomesForGig } from "@/app/_lib/gigs/outcome";
import { qualifyAndMatch } from "@/app/_lib/gigs/qualify";
import { routeGig, unrouteGig } from "@/app/_lib/gigs/routing";
import { canTransitionGig } from "@/app/_lib/gigs/transitions";
import type { GigStatus } from "@/app/_lib/gigs/types";
import { clientIpFrom, rateLimit } from "@/app/_lib/rate-limit";

// /api/gigs/[id]
// GET   -> { gig, attempts (oldest first), outcomes (oldest first) }
// PATCH { action: "decline" | "withdraw" | "clear_suspect" | "route" | "unroute" }
//   decline / withdraw  the gig moves to declined / withdrawn from any status whose
//                       edge the state machine holds (gigs/transitions.ts); a draft
//                       still waiting on review (drafted | approved) is discarded with
//                       it, so no reviewable card outlives its gig.
//   clear_suspect       suspect -> new with the reasons emptied (the operator read the
//                       flag and judged it a false positive), then qualified again.
//   route               { specialistId }: the gig goes to that specialist (gigs/routing.ts)
//                       - same workspace and arena (else 409 GIG_ROUTE_ARENA_MISMATCH), a
//                       runnable hire (else 409 GIG_SPECIALIST_NOT_READY); allowed while
//                       new | qualified | drafted | in_review and not suspect, never while
//                       dispatched. A routed `new` gig is re-qualified.
//   unroute             the routing is cleared and the matcher's pick replaces it.
// An action the gig's status does not allow is 409 GIG_ACTION_NOT_ALLOWED; a move lost
// to a concurrent one is 409 GIG_STATE_CHANGED.

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    const { id } = await params;
    const ws = await currentWorkspace();
    const gig = getGig(ws, id);
    if (!gig) return jsonRefusal("GIG_NOT_FOUND", 404);
    return NextResponse.json({ gig, attempts: listGigAttemptsForGig(ws, id), outcomes: listOutcomesForGig(ws, id) });
  } catch (error) {
    return safeJsonError(error, "api:gigs/[id]", "GIG_STORE_FAILED");
  }
}

const PATCH_ACTIONS = ["decline", "withdraw", "clear_suspect", "route", "unroute"] as const;
type PatchAction = (typeof PATCH_ACTIONS)[number];

export async function PATCH(request: Request, { params }: Params): Promise<NextResponse> {
  const denied = await requireOperator();
  if (denied) return denied;
  const under = await requireCapabilityCoded("pipeline:write", requireCapability);
  if (under) return under;
  if (!rateLimit(`gigs-write:${clientIpFrom(request.headers)}`, { limit: 120, windowMs: 10 * 60_000 })) {
    return jsonRefusal("TOO_MANY_REQUESTS", 429);
  }
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; specialistId?: unknown };
    const action = body.action;
    if (typeof action !== "string" || !(PATCH_ACTIONS as readonly string[]).includes(action)) {
      return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "action", allowed: PATCH_ACTIONS });
    }
    if (action === "route" && (typeof body.specialistId !== "string" || !body.specialistId.trim())) {
      return jsonRefusal("GIG_INPUT_INVALID", 400, { field: "specialistId" });
    }
    const ws = await currentWorkspace();

    if (action === "route" || action === "unroute") {
      const res = action === "route" ? routeGig(ws, id, String(body.specialistId).trim()) : unrouteGig(ws, id);
      if (res.ok) return NextResponse.json({ gig: res.gig });
      const extra = res.code === "GIG_ACTION_NOT_ALLOWED" ? { gigStatus: res.gigStatus } : res.code === "GIG_SPECIALIST_NOT_READY" ? { detail: res.detail } : undefined;
      return jsonRefusal(res.code, res.status, extra);
    }

    const gig = getGig(ws, id);
    if (!gig) return jsonRefusal("GIG_NOT_FOUND", 404);

    if ((action as PatchAction) === "clear_suspect") {
      if (gig.status !== "suspect") return jsonRefusal("GIG_ACTION_NOT_ALLOWED", 409, { gigStatus: gig.status });
      const cleared = clearGigSuspect(ws, id);
      if (!cleared.ok) return jsonRefusal("GIG_STATE_CHANGED", 409);
      const qualified = qualifyAndMatch(ws, id);
      return NextResponse.json({ gig: qualified.ok ? qualified.gig : cleared.gig });
    }

    const to: GigStatus = action === "decline" ? "declined" : "withdrawn";
    if (!canTransitionGig(gig.status, to)) return jsonRefusal("GIG_ACTION_NOT_ALLOWED", 409, { gigStatus: gig.status });
    const moved = transitionGig(ws, id, { from: gig.status, to });
    if (!moved.ok) return jsonRefusal(moved.reason === "not_found" ? "GIG_NOT_FOUND" : "GIG_STATE_CHANGED", moved.reason === "not_found" ? 404 : 409);
    // A reviewable draft does not outlive its gig. Each discard is its own CAS: a draft
    // that moved meanwhile keeps the state it moved to.
    for (const attempt of listGigAttemptsForGig(ws, id)) {
      if (attempt.status === "drafted" || attempt.status === "approved") {
        transitionGigAttempt(ws, attempt.id, { from: attempt.status, to: "discarded" });
      }
    }
    return NextResponse.json({ gig: moved.gig });
  } catch (error) {
    return safeJsonError(error, "api:gigs/[id]", "GIG_STORE_FAILED");
  }
}
