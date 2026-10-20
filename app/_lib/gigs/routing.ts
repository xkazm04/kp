import { getHiredAgent } from "../db/agents";
import { getGig, setGigRoute } from "../db/gigs";
import { getGigSpecialist } from "../db/gigs-specialists";
import { canRouteGig, GIG_RUNNABLE_HIRE_STATUSES, pickGigMatch } from "./match";
import { qualifyAndMatch, rankGigSpecialists } from "./qualify";
import type { Gig } from "./types";

// Routing: the operator's override of the matcher (PATCH /api/gigs/[id] `route` /
// `unroute`, docs/features/gigs/README.md "Matchmaking and routing").
//
//   route    the gig goes to THIS specialist: same workspace, same arena, a runnable hire
//            (onboarding | active). Sets `specialist_id` and copies the specialist's niche
//            onto the gig, so the matcher's `routed` signal (match.ts) keeps the choice on
//            every later ranking. A `new` gig is re-qualified at once, so a routed gig can
//            become qualified.
//   unroute  the routing is cleared (niche null) and the matcher's pick replaces it - the
//            best ready candidate, or none. A `new` gig is re-qualified the same way.
// Both are allowed while the gig is new | qualified | drafted | in_review and not suspect
// (match.ts canRouteGig); never while dispatched. The write is a CAS on the status read.
// Synchronous - every step a local store call, nothing awaited.

export type RouteGigRefusal =
  | { ok: false; code: "GIG_NOT_FOUND"; status: 404 }
  | { ok: false; code: "GIG_ACTION_NOT_ALLOWED"; status: 409; gigStatus: Gig["status"] }
  | { ok: false; code: "GIG_SPECIALIST_NOT_READY"; status: 409; detail: string }
  | { ok: false; code: "GIG_ROUTE_ARENA_MISMATCH"; status: 409 }
  | { ok: false; code: "GIG_STATE_CHANGED"; status: 409 };

export type RouteGigResult = { ok: true; gig: Gig } | RouteGigRefusal;

function requalified(workspaceId: string, gig: Gig): Gig {
  if (gig.status !== "new") return gig;
  const q = qualifyAndMatch(workspaceId, gig.id);
  return q.ok ? q.gig : gig;
}

export function routeGig(workspaceId: string, gigId: string, specialistId: string): RouteGigResult {
  const gig = getGig(workspaceId, gigId);
  if (!gig) return { ok: false, code: "GIG_NOT_FOUND", status: 404 };
  if (!canRouteGig(gig)) return { ok: false, code: "GIG_ACTION_NOT_ALLOWED", status: 409, gigStatus: gig.status };
  // Another workspace's specialist reads as absent, exactly like one that never existed.
  const specialist = getGigSpecialist(workspaceId, specialistId);
  if (!specialist) return { ok: false, code: "GIG_SPECIALIST_NOT_READY", status: 409, detail: "no_specialist" };
  if (specialist.spec.arena !== gig.arena) return { ok: false, code: "GIG_ROUTE_ARENA_MISMATCH", status: 409 };
  const agent = getHiredAgent(specialist.hiredAgentId, workspaceId);
  if (!agent || !GIG_RUNNABLE_HIRE_STATUSES.includes(agent.status)) {
    return { ok: false, code: "GIG_SPECIALIST_NOT_READY", status: 409, detail: agent ? `hire_${agent.status}` : "no_hire" };
  }
  const routed = setGigRoute(workspaceId, gigId, { expectedStatus: gig.status, specialistId: specialist.id, niche: specialist.spec.niche });
  if (!routed.ok) return routed.reason === "not_found" ? { ok: false, code: "GIG_NOT_FOUND", status: 404 } : { ok: false, code: "GIG_STATE_CHANGED", status: 409 };
  return { ok: true, gig: requalified(workspaceId, routed.gig) };
}

export function unrouteGig(workspaceId: string, gigId: string): RouteGigResult {
  const gig = getGig(workspaceId, gigId);
  if (!gig) return { ok: false, code: "GIG_NOT_FOUND", status: 404 };
  if (!canRouteGig(gig)) return { ok: false, code: "GIG_ACTION_NOT_ALLOWED", status: 409, gigStatus: gig.status };
  // Ranked as if never routed: no niche pin, no incumbent to keep on a tie.
  const pick = pickGigMatch(rankGigSpecialists(workspaceId, { ...gig, niche: null, specialistId: null }));
  const cleared = setGigRoute(workspaceId, gigId, { expectedStatus: gig.status, specialistId: pick?.specialistId ?? null, niche: null });
  if (!cleared.ok) return cleared.reason === "not_found" ? { ok: false, code: "GIG_NOT_FOUND", status: 404 } : { ok: false, code: "GIG_STATE_CHANGED", status: 409 };
  return { ok: true, gig: requalified(workspaceId, cleared.gig) };
}
