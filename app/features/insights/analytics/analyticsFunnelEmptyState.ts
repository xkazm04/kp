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
//
// The module also carries the funnel's OTHER honesty gate — `stageVerdict` /
// `pickWeakestLink` (UAT TOM-ANA-9). Both answer the same question at different
// grains: *what is this funnel allowed to claim?* Movement licenses a
// conversion number at all; an org-set goal licenses a judgement about it.
// Keeping them in one module is deliberate — the `?? 50` they replace was
// duplicated at three call sites and drifted out of the one place that
// disclosed it.

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
 * reaches it. Keyed by the canonical FUNNEL_STAGES names, valued by the
 * `analytics.funnelGuide.*` catalog key that carries the copy — this module
 * stays pure and locale-free; the component resolves the key with its own `t`.
 */
export type StageQuestionKey =
  | "questionAccepted"
  | "questionScreened"
  | "questionInterview"
  | "questionOffer"
  | "questionHired"
  | "questionFallback";

const STAGE_QUESTION: Record<string, StageQuestionKey> = {
  Accepted: "questionAccepted",
  Screened: "questionScreened",
  Interview: "questionInterview",
  Offer: "questionOffer",
  Hired: "questionHired",
};

/** The question a stage answers; a neutral fallback keeps a custom axis safe. */
export function stageQuestionKey(stage: string): StageQuestionKey {
  return STAGE_QUESTION[stage] ?? "questionFallback";
}

// ---------------------------------------------------------------------------
// UAT TOM-ANA-9 — no verdict colour without an org goal.
//
// The funnel used to judge every stage against `targets.conversion[stage] ?? 50`
// and paint the row coral when it fell short. Nobody in the org ever agreed to
// that 50 %, and no surface disclosed it: the reader saw a red row and read it
// as *their* number failing *their* target. A colour is a judgement, and a
// judgement needs a benchmark somebody actually set — otherwise the honest
// output is a reading with no colour at all.
//
// `"none"` is therefore not an error state. It is the correct answer whenever
// the org has not said what good looks like, and it is what a stage wears until
// somebody opens the goals editor.
// ---------------------------------------------------------------------------

/** met / missed require a goal; without one the stage carries no colour. */
export type StageVerdict = "met" | "missed" | "none";

/** Per-stage conversion goals as the analytics payload ships them (`targets.conversion`). */
export type ConversionGoals = Record<string, number | undefined>;

/**
 * The verdict a stage row is allowed to wear.
 *
 * Both inputs must be present: a null conversion (the first stage, or a stage
 * whose predecessor never had anybody) has nothing to judge, and a missing goal
 * has nothing to judge it against.
 */
export function stageVerdict(conversionPct: number | null | undefined, goal: number | null | undefined): StageVerdict {
  if (conversionPct == null || goal == null) return "none";
  return conversionPct < goal ? "missed" : "met";
}

/** True once at least one stage on THIS axis carries a goal the org set. */
export function hasAnyConversionGoal(funnel: FunnelRow[], goals: ConversionGoals): boolean {
  return funnel.some((f) => goals[f.stage] != null);
}

/** True while at least one stage with a real conversion number has no goal to be judged by. */
export function hasUngoaledStage(funnel: FunnelRow[], goals: ConversionGoals): boolean {
  return funnel.some((f) => f.conversionPct != null && goals[f.stage] == null);
}

/** The weakest link, once there is a goal to be weak against. */
export type WeakestLink = { stage: string; conversionPct: number; goal: number; gap: number };

/**
 * The stage furthest below ITS OWN goal — the brief's lead story, and the one
 * claim on this tab that names a stage as a failure.
 *
 * Returns null when no goal is set, which is the whole point: without a goal
 * there is no weakest *link*, only a lowest *number*, and the brief must not
 * promote the second into the first.
 */
export function pickWeakestLink(funnel: FunnelRow[], goals: ConversionGoals): WeakestLink | null {
  return (
    funnel
      .flatMap((f) => {
        const goal = goals[f.stage];
        if (f.conversionPct == null || goal == null) return [];
        return [{ stage: f.stage, conversionPct: f.conversionPct, goal, gap: goal - f.conversionPct }];
      })
      .filter((x) => x.gap > 0)
      .sort((a, b) => b.gap - a.gap)[0] ?? null
  );
}

// ---------------------------------------------------------------------------
// The funnel band's RENDER MAP, as a pure value.
//
// UAT TOM-ANA-3 is not really "a missing empty state" — it is "a guard that no
// test could see". `hasNoStageTransitions` and its guide were written, translated
// into four locales, and then quietly left off the render path, where nothing
// failed because nothing pinned which branch the band takes. Resolving the branch
// here, and having the component do nothing but map the branch to JSX, means the
// precedence is a value a `node:test` can assert against a REAL analytics payload
// — orphaning it again would fail that test.
// ---------------------------------------------------------------------------

export type FunnelBandState =
  /** No pipeline entry has ever existed; the tab has no subject at all. */
  | { kind: "no-data" }
  /** Entries exist but nobody has crossed a boundary — conversion measures movement. */
  | { kind: "no-movement" }
  /** A stage is holding people too long; dwell, not conversion, is the story. */
  | { kind: "stalled" }
  /** A stage is below a goal the ORG set — the only branch allowed to name a failure. */
  | { kind: "weakest"; link: WeakestLink }
  /** Conversion is real and readable, but no goal exists to judge it against. */
  | { kind: "no-goal" }
  /** Every goal-bearing stage is clearing its goal. */
  | { kind: "healthy" };

/**
 * Which claim the funnel band is entitled to make.
 *
 * The order is the argument: movement licenses a conversion number at all, so it
 * is checked before anything conversion-shaped; dwell is a separate measurement
 * and keeps its precedence over conversion; and a goal the org set is the last
 * gate before the band is allowed to call a stage weak.
 */
export function funnelBandState(input: {
  total: number;
  funnel: FunnelRow[];
  goals: ConversionGoals;
  hasBottleneck: boolean;
}): FunnelBandState {
  const { total, funnel, goals, hasBottleneck } = input;
  if (total === 0) return { kind: "no-data" };
  if (hasNoStageTransitions(funnel)) return { kind: "no-movement" };
  if (hasBottleneck) return { kind: "stalled" };
  const link = pickWeakestLink(funnel, goals);
  if (link) return { kind: "weakest", link };
  if (hasUngoaledStage(funnel, goals)) return { kind: "no-goal" };
  return { kind: "healthy" };
}
