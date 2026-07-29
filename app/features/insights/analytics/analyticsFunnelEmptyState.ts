// The FUNNEL's own zero-state — deliberately NOT the tab-level one.
//
// Round 1 (`AnalyticsEmptyPreview`) answers "nothing has ever happened here":
// no pipeline entry exists at all, so the whole tab has no subject. That state
// is rendered once, in the by-role table, and it stays the tab's single
// first-run hero.
//
// This module answers a narrower and much more common condition: entries DO
// exist — the top of the funnel has a real number, the stat cluster is
// populated, channels may already be reporting — but **no candidate has ever
// crossed a stage boundary**. A funnel is a measurement of hand-offs, not of
// people; with zero transitions every conversion ratio it can compute is either
// null or a 0% that means "not yet", not "we lose everyone here". Rendering the
// live bars in that situation prints a column of zeros that reads as failure.
//
// Pure + DB-free so the predicate is unit-testable and has exactly one
// definition shared by both prototype variants.

/** Structural mirror of AnalyticsTab's `Funnel` row (kept local so this module has no cycle). */
export type FunnelRow = { stage: string; reached: number; current: number; conversionPct: number | null };

/**
 * True when the funnel axis has recorded ZERO stage transitions — nobody has
 * ever reached anything past the first stage.
 *
 * Note this is independent of `total`: the caller keeps its own `total === 0`
 * branch ahead of this one, so the two conditions never compete for the same
 * pixels. Requires at least two stages, since a single-stage axis has no
 * hand-off to be empty of.
 */
export function hasNoStageTransitions(funnel: FunnelRow[]): boolean {
  return funnel.length >= 2 && funnel.slice(1).every((f) => f.reached === 0);
}

/**
 * What each funnel stage will let a recruiter decide, once a candidate first
 * reaches it. Keyed by the canonical FUNNEL_STAGES names. This is copy, not
 * data — no figure here is ever presented as a measurement.
 */
const STAGE_QUESTION: Record<string, string> = {
  Accepted: "Who arrived, and which channel sent them.",
  Screened: "What share of your applicants clear the first evaluation.",
  Interview: "Whether screening is letting the right people through.",
  Offer: "How selective the interview loop actually is.",
  Hired: "Your end-to-end hire rate, and how long it took.",
};

/** The question a stage answers; a neutral fallback keeps a custom axis safe. */
export function stageQuestion(stage: string): string {
  return STAGE_QUESTION[stage] ?? "How many candidates get this far.";
}
