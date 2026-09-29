import type { Gig, GigAttempt, GigStatus } from "@/app/_lib/gigs/types";
import { reachedStep } from "./line";
import { laneOfGig, type Niche, NO_LANE } from "./niches";

// ---------------------------------------------------------------------------
// Lanes: niches as rows, the lifecycle as columns
// ---------------------------------------------------------------------------

/** The line a gig walks. The two verdicts share one column: the judge's. */
export const LANE_STEPS = ["new", "suspect", "qualified", "dispatched", "drafted", "in_review", "sent", "verdict"] as const;
export type LaneStep = (typeof LANE_STEPS)[number];

/** The three ways off the line, counted apart: an exit, not a stage. */
export const EXIT_STATUSES = ["declined", "withdrawn", "expired"] as const satisfies readonly GigStatus[];

export function laneStepOf(status: GigStatus): LaneStep | null {
  if (status === "accepted" || status === "rejected") return "verdict";
  return (LANE_STEPS as readonly string[]).includes(status) ? (status as LaneStep) : null;
}

/** The steps whose next move is the operator's (washed coral on the lanes). */
export const YOUR_STEPS: ReadonlySet<LaneStep> = new Set<LaneStep>(["suspect", "drafted", "in_review"]);

export type LaneCell = { step: LaneStep; count: number; reached: boolean };
export type LaneRow = { key: string; cells: LaneCell[]; exit: number; total: number };

/** One row per niche plus the unrouted pool (`NO_LANE`, last). A zero cell is either
 *  "none here now" (the lane reached the step and moved on) or "never reached" - two
 *  facts that never render alike. */
export function laneRows(
  gigs: readonly Gig[],
  attemptsByGig: Readonly<Record<string, GigAttempt>>,
  niches: readonly Pick<Niche, "key">[],
  nicheBySpecialist: ReadonlyMap<string, string>
): LaneRow[] {
  const byLane = new Map<string, Gig[]>();
  for (const g of gigs) {
    const k = laneOfGig(g, attemptsByGig[g.id] ?? null, nicheBySpecialist);
    byLane.set(k, [...(byLane.get(k) ?? []), g]);
  }
  return [...niches.map((n) => n.key), NO_LANE].map((key) => {
    const mine = byLane.get(key) ?? [];
    const cells = LANE_STEPS.map((step) => {
      const count = mine.filter((g) => laneStepOf(g.status) === step).length;
      const reached =
        count > 0 ||
        (step === "verdict"
          ? mine.some((g) => g.status === "accepted" || g.status === "rejected")
          : reachedStep(mine, attemptsByGig, step as Exclude<LaneStep, "verdict">));
      return { step, count, reached };
    });
    const exit = mine.filter((g) => (EXIT_STATUSES as readonly string[]).includes(g.status)).length;
    return { key, cells, exit, total: mine.length };
  });
}
