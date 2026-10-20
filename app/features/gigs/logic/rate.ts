import { GIG_ARENAS, type GigKpi, type GigKpiCell } from "@/app/_lib/gigs/types";

// ---------------------------------------------------------------------------
// The rate - a fraction first, a percentage only beside its n
// ---------------------------------------------------------------------------

export type RateView = {
  measured: boolean;
  accepted: number;
  resolved: number;
  pending: number;
  /** Whole percent; null while unmeasured (never 0%). */
  percent: number | null;
  small: boolean;
};

export function rateView(cell: GigKpiCell | null | undefined): RateView {
  if (!cell) return { measured: false, accepted: 0, resolved: 0, pending: 0, percent: null, small: true };
  const measured = cell.resolved > 0 && cell.rate !== null;
  return {
    measured,
    accepted: cell.accepted,
    resolved: cell.resolved,
    pending: cell.pending,
    percent: measured ? Math.round((cell.rate as number) * 100) : null,
    small: cell.smallSample,
  };
}

/** The whole desk's cell: every sent attempt belongs to exactly one gig, and every gig
 *  to exactly one arena, so the arena cells partition it and add up honestly. */
export function overallCell(kpi: Pick<GigKpi, "byArena">): GigKpiCell {
  let resolved = 0;
  let accepted = 0;
  let pending = 0;
  let costUnreported = 0;
  for (const a of GIG_ARENAS) {
    const c = kpi.byArena[a];
    if (!c) continue;
    resolved += c.resolved;
    accepted += c.accepted;
    pending += c.pending;
    costUnreported += c.costUnreported;
  }
  return {
    resolved,
    accepted,
    pending,
    rate: resolved === 0 ? null : accepted / resolved,
    costPerAcceptedUsd: null,
    costUnreported,
    smallSample: resolved < 10,
  };
}

/** The qualification bar, as qualify.ts QUALIFY_THRESHOLD states it. Restated rather
 *  than imported because qualify.ts reaches the store; rate.test.ts reads the
 *  source and fails if the two disagree. */
export const QUALIFY_BAR = 50;
