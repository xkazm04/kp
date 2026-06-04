// Canonical pipeline / funnel stage axis + the archetype-fairness predicate.
//
// Kept in a pure, DB-free module (no better-sqlite3 import) so the fairness metric
// is unit-testable in isolation and so the stage order has one single source. db.ts
// re-exports these, so existing `import { PIPELINE_STAGES } from "./db"` call sites
// keep working unchanged.

// Consolidated 5-stage model. "Accepted" = CV received (inbound or proactively
// sourced), waiting for screening; "Screened" = run through the first wave of
// evaluation (matching + AI screening). Legacy Sourced→Accepted and
// AI-matched/Screening→Screened are remapped by migratePipelineStages() on boot.
export const PIPELINE_STAGES = ["Accepted", "Screened", "Interview", "Offer", "Hired"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Accepted is now a real first stage IN the canonical progression, so the funnel
// axis is just the pipeline stages — no separate prefix.
export const FUNNEL_STAGES = PIPELINE_STAGES;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

/** True when an entry at `stage` has advanced PAST the screening gate — i.e. has
 *  reached Interview or beyond. This is the headline archetype-fairness metric
 *  ("{pct}% advanced past screening"): screening is the gate that most often
 *  filters out non-traditional candidates, so the equity story is whether they
 *  CLEARED it (got a real interview), not merely whether they reached Screened.
 *  A candidate sitting AT Screened has NOT yet advanced past it. Mirrors the
 *  byJob "reached interview" threshold so the two funnel metrics stay consistent.
 *  Single source for both the computation and its label so they can't drift. */
export function hasAdvancedPastScreening(stage: string): boolean {
  return FUNNEL_STAGES.indexOf(stage as FunnelStage) >= FUNNEL_STAGES.indexOf("Interview");
}
