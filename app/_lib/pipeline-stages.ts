// Canonical pipeline / funnel stage axis + the archetype-fairness predicate.
//
// Kept in a pure, DB-free module (no better-sqlite3 import) so the fairness metric
// is unit-testable in isolation and so the stage order has one single source. db.ts
// re-exports these, so existing `import { PIPELINE_STAGES } from "./db/pipeline";` call sites
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

// The pre-interview screening stages — the funnel positions where a manual
// "Screen with AI" run is meaningful, exactly the stages BEFORE Interview.
// "Accepted" (CV received) screens a fresh applicant INTO "Screened"; "Screened"
// (matched + AI-screened) screens them on toward "Interview". Defined here, off
// the canonical axis, so the drawer's action gate and runAutomationTask's screen
// handler read ONE set instead of each hardcoding stage literals. Kept in lockstep
// with hasAdvancedPastScreening by the pipeline-screening test (these are precisely
// the not-yet-past-screening stages).
export const SCREENING_STAGES = ["Accepted", "Screened"] as const;
export type ScreeningStage = (typeof SCREENING_STAGES)[number];

export function isScreeningStage(stage: string): stage is ScreeningStage {
  return (SCREENING_STAGES as readonly string[]).includes(stage);
}

// The pipeline effect of a manual AI screen run at `stage`, given the screen
// `route` ∈ {advance, hold} (the {advance,hold} subset of the verdict taxonomy —
// see SCREEN_ROUTES; a weak/early-career verdict is already coerced to "hold" by
// the fairness gate in screen_candidate, so a screen NEVER auto-rejects).
//   - advance:       advance the entry ONE stage (Accepted→Screened, Screened→Interview).
//   - holdForReview: set a screening_review approval + log a screening_hold so a
//                    human resolves it in the Decisions queue.
//   - applied:       the AutomationResult.applied label the drawer surfaces.
export type ScreenStageOutcome = { advance: boolean; holdForReview: boolean; applied: string };

/** Decide what a manual AI screen does at a given stage. Pure, so the
 *  Accepted-stage triage contract is unit-tested in isolation; runAutomationTask
 *  applies the effects.
 *
 *  Accepted is the funnel entry: screening a fresh applicant ALWAYS moves them
 *  into Screened — the same fair, archetype-neutral, never-reject Accepted→Screened
 *  move the policy pass makes once a candidate is scored. The screen's confidence
 *  only decides how they land: a clean "advance" lands them in Screened ready for
 *  the interview gate; a cautious "hold" lands them in Screened flagged for human
 *  review. Either way the screening_review ends up on a Screened entry, so the
 *  existing Decisions→Interview machinery (calendar queue, interview-prep) is
 *  reused unchanged. From Screened a clean advance moves to Interview; otherwise it
 *  holds in place for review. A non-screening stage is advisory only — the verdict
 *  is informational and nothing moves. */
export function screenStageOutcome(stage: string, route: string): ScreenStageOutcome {
  if (!isScreeningStage(stage)) return { advance: false, holdForReview: false, applied: "advisory" };
  const cleared = route === "advance";
  if (stage === "Accepted") {
    return { advance: true, holdForReview: !cleared, applied: cleared ? "advanced" : "held_for_review" };
  }
  return { advance: cleared, holdForReview: !cleared, applied: cleared ? "advanced" : "held_for_review" };
}
