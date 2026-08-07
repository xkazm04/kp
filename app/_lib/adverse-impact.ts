// P1-1 — the four-fifths (80%) adverse-impact rule, the standard protected-class
// fairness lens (EEOC Uniform Guidelines). A group's SELECTION RATE is
// selected/total; the rule compares every group's rate to the highest-rate
// (reference) group, and flags any group whose ratio falls below 0.8 as showing
// potential adverse impact.
//
// HONEST CEILING — read this before surfacing the result. This is a READY
// PRIMITIVE, not an automatic monitor. A real statutory adverse-impact analysis
// needs aggregate demographic counts (race / sex / age band / disability /
// veteran status) per group. THIS PLATFORM COLLECTS NO DEMOGRAPHIC DATA, so it
// cannot and does not run this on stored candidates. The function is pure and
// stateless: a workspace that holds its OWN aggregate counts (e.g. from a
// separate EEO survey) can compute the ratio ad hoc — nothing is read from or
// written to the candidate store. The app's automated-rejection fairness gate is
// a separate thing: an ARCHETYPE shield (early-career / unknown), NOT a
// protected-class test. See app/_lib/archetypes.ts.

/** The four-fifths threshold: a selection-rate ratio below this is flagged. */
export const FOUR_FIFTHS = 0.8;

/**
 * Minimum applicants a group must have for its selection rate to be trusted — the
 * four-fifths rule is statistically meaningless below an adequate sample. Mirrors
 * the min-cohort gates its siblings enforce (`calibration.ts`
 * MIN_CALIBRATION_OUTCOMES = 20, `db/salary-benchmark.ts`
 * SALARY_BENCHMARK_MIN_COHORT = 3) so this legally-loaded surface doesn't render a
 * verdict from noise. A group below this floor can neither BE the reference nor be
 * flagged; it reports `reliable: false` and the UI must show an "insufficient
 * sample" state, not a coral/green verdict.
 *
 * WHY 30: the EEOC Uniform Guidelines (29 CFR 1607.4D) themselves caution that a
 * four-fifths difference "based on small numbers" and "not statistically
 * significant" does not establish adverse impact. There is no single codified
 * floor, so we adopt the standard rule-of-thumb minimum for a stable proportion
 * estimate (n ≥ 30) — the smallest sample at which a selection RATE is defensible
 * enough to anchor or be measured against. A full analysis needs ≥2 such groups
 * (one reference + one comparison) before any ratio is asserted.
 */
export const ADVERSE_IMPACT_MIN_COHORT = 30;

/** Aggregate counts for one group the recruiter supplies. */
export type GroupCount = { group: string; selected: number; total: number };

export type GroupImpact = {
  group: string;
  /** Clamped, non-negative selected count (≤ total). */
  selected: number;
  total: number;
  /** selected / total, or 0 when total is 0. */
  selectionRate: number;
  /** This group's rate ÷ the reference group's rate. null when there is no valid
   *  reference (no group has any applicants, the reference rate is 0), or this
   *  group is below {@link ADVERSE_IMPACT_MIN_COHORT} (an unreliable rate is never
   *  turned into an authoritative ratio). */
  impactRatio: number | null;
  /** True when impactRatio < {@link FOUR_FIFTHS}. The reference group itself is
   *  never flagged (its ratio is 1); sub-cohort groups are never flagged either. */
  adverseImpact: boolean;
  /** The highest-selection-rate group the others are measured against. Only groups
   *  meeting {@link ADVERSE_IMPACT_MIN_COHORT} can be the reference. */
  isReference: boolean;
  /** True when this group's own sample (total) meets {@link ADVERSE_IMPACT_MIN_COHORT}.
   *  When false the UI must render an "insufficient sample" state — NOT a verdict. */
  reliable: boolean;
};

export type AdverseImpactResult = {
  groups: GroupImpact[];
  /** The reference (highest-rate) group's name, or null when none qualifies. */
  referenceGroup: string | null;
  /** True when any group falls below the four-fifths threshold. */
  anyAdverseImpact: boolean;
  /** True only when at least two groups meet {@link ADVERSE_IMPACT_MIN_COHORT} — the
   *  minimum to anchor a reference and measure one comparison against it. When false
   *  the sample is too small to assess and the UI MUST show "insufficient sample"
   *  instead of an adverse / no-adverse verdict (`anyAdverseImpact` is forced false). */
  reliable: boolean;
};

function clampCounts(g: GroupCount): { group: string; selected: number; total: number } {
  const total = Math.max(0, Math.floor(Number(g.total) || 0));
  // A selected count above the total (or negative) is bad data — clamp into range
  // rather than producing a >100% selection rate that would corrupt the reference.
  const selected = Math.min(total, Math.max(0, Math.floor(Number(g.selected) || 0)));
  return { group: g.group, selected, total };
}

/**
 * Compute the four-fifths adverse-impact analysis for a set of groups.
 *
 * Pure and order-independent. The reference group is the one with the HIGHEST
 * selection rate among groups that had applicants (total > 0) AND meet the
 * {@link ADVERSE_IMPACT_MIN_COHORT} floor; ties pick the first such group in input
 * order (deterministic). Groups below the floor (or with no applicants) carry a
 * null ratio and are never flagged or used as the reference — a single-applicant
 * "100%" group can no longer become the reference and flip the whole verdict.
 *
 * When fewer than two groups meet the floor the result is `reliable: false` and
 * `anyAdverseImpact` is forced false: the sample is too small to assess, which is a
 * DISTINCT state from "no adverse impact". If the reference rate is 0 (nobody was
 * selected anywhere) every ratio is null and nothing is flagged.
 */
export function computeAdverseImpact(rawGroups: readonly GroupCount[]): AdverseImpactResult {
  const cleaned = rawGroups.map(clampCounts);
  const withRate = cleaned.map((g) => ({
    ...g,
    selectionRate: g.total > 0 ? g.selected / g.total : 0,
    reliable: g.total >= ADVERSE_IMPACT_MIN_COHORT,
  }));

  // Reference = highest selection rate among groups that clear the min-cohort floor.
  // Sub-floor groups (e.g. n=1 at 100%) are excluded so they can't anchor the verdict.
  let reference: (typeof withRate)[number] | null = null;
  for (const g of withRate) {
    if (!g.reliable) continue;
    if (reference === null || g.selectionRate > reference.selectionRate) reference = g;
  }
  const referenceRate = reference?.selectionRate ?? 0;

  // The analysis is only trustworthy with a reference PLUS at least one other group
  // that clears the floor to measure against it.
  const reliableCount = withRate.filter((g) => g.reliable).length;
  const reliable = reliableCount >= 2;

  const groups: GroupImpact[] = withRate.map((g) => {
    const isReference = reference !== null && g.group === reference.group && g.reliable;
    // A ratio needs a reference WITH a positive rate, and the group itself must clear
    // the floor — otherwise it's undefined / unreliable, not "no adverse impact".
    const ratioMeasurable = reference !== null && referenceRate > 0 && g.reliable;
    const impactRatio = ratioMeasurable ? g.selectionRate / referenceRate : null;
    const adverseImpact = impactRatio !== null && !isReference && impactRatio < FOUR_FIFTHS;
    return {
      group: g.group,
      selected: g.selected,
      total: g.total,
      selectionRate: g.selectionRate,
      impactRatio,
      adverseImpact,
      isReference,
      reliable: g.reliable,
    };
  });

  return {
    groups,
    referenceGroup: reference?.group ?? null,
    anyAdverseImpact: reliable && groups.some((g) => g.adverseImpact),
    reliable,
  };
}
