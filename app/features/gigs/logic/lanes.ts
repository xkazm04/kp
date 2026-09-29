import { GIG_TYPES, gigTypeOf, type GigType } from "@/app/_lib/gigs/gig-type";
import type { Gig, GigAttempt, GigStatus } from "@/app/_lib/gigs/types";
import { reachedStep } from "./line";
import type { SpecialistRow } from "./wire";

// ---------------------------------------------------------------------------
// Lanes: gig types as rows, the lifecycle as columns
// ---------------------------------------------------------------------------
//
// A lane is the KIND of work (app/_lib/gigs/gig-type.ts gigTypeOf: the brief category's
// head, else the arena's fallback), not the niche specialist that once held it: each gig
// is paired with its own persona now (gig-mastery S2), so the type is what a row shares.

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
export type LaneRow = { key: GigType; cells: LaneCell[]; exit: number; total: number };

/** One row per gig type, in the vocabulary's order. A zero cell is either "none here now"
 *  (the lane reached the step and moved on) or "never reached" - two facts that never
 *  render alike. */
export function laneRows(gigs: readonly Gig[], attemptsByGig: Readonly<Record<string, GigAttempt>>): LaneRow[] {
  const byLane = new Map<GigType, Gig[]>();
  for (const g of gigs) {
    const k = gigTypeOf(g);
    byLane.set(k, [...(byLane.get(k) ?? []), g]);
  }
  return GIG_TYPES.map((key) => {
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

/** Each type's gig personas (a specialist hired for ONE gig, `gigId`), filed under the type
 *  of the gig it serves. Niche specialists serve many gigs of many types, so they belong to
 *  no lane (they finish their open drafts and retire). */
export function personasByType(gigs: readonly Gig[], specialists: readonly SpecialistRow[]): Record<GigType, SpecialistRow[]> {
  const typeOf = new Map(gigs.map((g) => [g.id, gigTypeOf(g)]));
  const out = Object.fromEntries(GIG_TYPES.map((t) => [t, [] as SpecialistRow[]])) as Record<GigType, SpecialistRow[]>;
  for (const s of specialists) {
    const type = s.gigId ? typeOf.get(s.gigId) : undefined;
    if (type) out[type].push(s);
  }
  return out;
}
