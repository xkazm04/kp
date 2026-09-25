import { canRouteGig, normalizeNicheLabel, pickGigMatch, rankSpecialistsForGig, suggestNicheForGig, type GigMatch } from "@/app/_lib/gigs/match";
import type { Gig, GigKpi } from "@/app/_lib/gigs/types";
import type { SpecialistRow } from "./gigsLogic";

// The gig page's Match panel (GigsRouting.tsx) as a pure derivation: the ranking comes from
// the SAME function the qualifier uses (app/_lib/gigs/match.ts), fed the specialists and
// the KPI the tab already read, so the page shows exactly the order the server would pick
// from. No React, no fetch - pinned by routingView.test.ts.

/** Why the operator cannot route this gig right now; null = they can. */
export type RoutingLock = "dispatched" | "suspect" | "closed" | null;

export type RankedCandidate = GigMatch & { specialist: SpecialistRow };

export type RoutingView = {
  ranked: RankedCandidate[];
  /** The specialist the gig is matched to now; null when none. */
  current: SpecialistRow | null;
  /** The operator routed it (the gig carries the current specialist's niche). */
  routed: boolean;
  lock: RoutingLock;
  /** No candidate both scores above 0 and is ready: offer a hire. */
  noFit: boolean;
  /** The niche the hire form starts on (match.ts suggestNicheForGig). */
  suggestedNiche: string | null;
};

export function routingLockOf(gig: Pick<Gig, "status" | "suspectReasons">): RoutingLock {
  if (canRouteGig(gig)) return null;
  if (gig.status === "dispatched") return "dispatched";
  if (gig.status === "suspect" || gig.suspectReasons.length > 0) return "suspect";
  return "closed";
}

export function routingView(gig: Gig, specialists: readonly SpecialistRow[], kpi: Pick<GigKpi, "bySpecialist"> | null): RoutingView {
  const byId = new Map(specialists.map((s) => [s.id, s]));
  const matches = rankSpecialistsForGig(
    gig,
    specialists.map((s) => {
      const cell = kpi?.bySpecialist[s.id];
      return {
        specialist: s,
        hireStatus: s.hire?.status ?? null,
        record: cell && cell.resolved > 0 ? { accepted: cell.accepted, resolved: cell.resolved } : null,
      };
    })
  );
  const ranked = matches.flatMap((m) => {
    const specialist = byId.get(m.specialistId);
    return specialist ? [{ ...m, specialist }] : [];
  });
  const current = gig.specialistId ? (byId.get(gig.specialistId) ?? null) : null;
  const routed = current !== null && gig.niche !== null && normalizeNicheLabel(gig.niche) === normalizeNicheLabel(current.spec.niche);
  return {
    ranked,
    current,
    routed,
    lock: routingLockOf(gig),
    noFit: pickGigMatch(matches) === null,
    suggestedNiche: suggestNicheForGig(gig),
  };
}
