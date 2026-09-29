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

/**
 * The significance companion's level: a two-sided p below this is "statistically
 * significant", about the two-standard-deviation line agencies and courts read. The
 * ratio alone is a screen that errs in both directions (29 CFR 1607.4D names both): at
 * small N a 0.6 ratio can be chance, and at large N a 0.95 ratio can be a real gap. So
 * every measured ratio carries this test beside it, and the verdict reads both.
 */
export const SIGNIFICANCE_ALPHA = 0.05;

/**
 * Two-sided Lancaster mid-P exact test for one group against the reference, on the
 * 2x2 table selected / not selected. Chosen over plain Fisher's exact test because
 * Fisher's is conservative at the cohort sizes this check sees (it misses real gaps),
 * while mid-P holds close to the nominal error rate with more power. It is exact at
 * every size and converges on the familiar Z-test at large N, so there is no switch
 * between a small-sample and a large-sample method. Tables exactly as likely as the
 * observed one count half: that is the mid-P correction.
 */
export function midPExactTwoSided(aSelected: number, aTotal: number, bSelected: number, bTotal: number): number {
  const n = aTotal + bTotal;
  const k = aSelected + bSelected;
  const lf = new Float64Array(n + 1);
  for (let i = 2; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
  const logP = (x: number) =>
    lf[k] + lf[n - k] + lf[aTotal] + lf[bTotal] - lf[n] - lf[x] - lf[aTotal - x] - lf[k - x] - lf[bTotal - k + x];
  const observed = logP(aSelected);
  let less = 0;
  let equal = 0;
  for (let x = Math.max(0, k - bTotal); x <= Math.min(k, aTotal); x++) {
    const lp = logP(x);
    if (lp < observed - 1e-7) less += Math.exp(lp);
    else if (lp <= observed + 1e-7) equal += Math.exp(lp);
  }
  return Math.min(1, less + equal / 2);
}

/** The power a comparison is read at: a group whose true rate sits at or below the
 *  {@link detectableRatio} is shown as a significant gap at least this often. */
export const DETECTABLE_POWER = 0.8;

function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26 (erf), accurate to ~1.5e-7 — far finer than a power
  // statement needs, and dependency-free like the rest of this module.
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) *
      Math.exp((-z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Power of the two-sided 5% two-proportion test to separate rates p0 and p1. */
function comparisonPower(p0: number, n0: number, p1: number, n1: number): number {
  const pooled = (n0 * p0 + n1 * p1) / (n0 + n1);
  const seNull = Math.sqrt(pooled * (1 - pooled) * (1 / n0 + 1 / n1));
  const seAlt = Math.sqrt((p0 * (1 - p0)) / n0 + (p1 * (1 - p1)) / n1);
  if (seAlt === 0) return 1;
  return normalCdf((p0 - p1 - 1.959964 * seNull) / seAlt);
}

/**
 * What a comparison could have SEEN. The largest ratio (group rate ÷ reference rate) at
 * which a group that truly selects at that ratio would still be shown as a significant
 * gap {@link DETECTABLE_POWER} of the time, given the reference's rate and both group
 * sizes. 0.33 reads: "this sample only reliably shows a group selected at a third of the
 * reference rate or less". 0 means it could not reliably show even a group that was never
 * selected at all. null when there is no reference rate to compare against.
 *
 * A non-significant result is silent about every gap smaller than this, so a "clean" or
 * "not significant" line that omits it reads as parity when it is only blindness. The
 * significant direction needs no such statement: the exact test holds its error rate at
 * any size, which is why no floor is placed on selections (a numerator floor would
 * suppress the zero-selected case, the most severe one).
 */
export function detectableRatio(referenceRate: number, referenceTotal: number, groupTotal: number): number | null {
  if (!(referenceRate > 0) || referenceTotal <= 0 || groupTotal <= 0) return null;
  if (comparisonPower(referenceRate, referenceTotal, 0, groupTotal) < DETECTABLE_POWER) return 0;
  let lo = 0;
  let hi = 1; // power falls as the ratio rises toward 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (comparisonPower(referenceRate, referenceTotal, referenceRate * mid, groupTotal) >= DETECTABLE_POWER) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Aggregate counts for one group the recruiter supplies. */
export type GroupCount = { group: string; selected: number; total: number };

/** The outcome of parsing the recruiter's pasted "group, selected, total" lines.
 *  Malformed rows are made VISIBLE (finding SD-4) rather than silently dropped: the
 *  reference group is "highest selection rate among whatever parsed", so quietly
 *  discarding a mistyped line can change which group anchors the ratio and flip a
 *  group between "ok" and "adverse impact". Blank/whitespace-only lines are not
 *  input and are neither parsed nor counted as malformed. */
export type ParsedGroupCounts = {
  /** The rows that parsed into a usable group count. */
  groups: GroupCount[];
  /** 1-based line numbers of NON-BLANK rows that failed to parse (not exactly three
   *  comma fields, an empty group name, or a non-numeric selected/total). */
  malformedRows: number[];
  /** Count of non-blank rows seen — `groups.length + malformedRows.length`. */
  nonBlankRows: number;
};

/**
 * Parse recruiter-pasted counts into groups, SURFACING malformed rows instead of
 * silently skipping them (finding SD-4). Each non-blank line must be EXACTLY `group,
 * selected, total` with a non-empty group name and a finite numeric selected and
 * total; any line that isn't is recorded in `malformedRows` (1-based, by original
 * line position) so the UI can warn that the verdict was computed over a subset —
 * never quietly excluded. Pure and stateless; blank lines are ignored (not errors).
 */
export function parseGroupCounts(text: string): ParsedGroupCounts {
  const groups: GroupCount[] = [];
  const malformedRows: number[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue; // a blank line is not input, not an error
    const parts = lines[i].split(",").map((p) => p.trim());
    // A trailing comma ("Women, 40, 100,") is punctuation, not a fourth field.
    while (parts.length > 3 && parts[parts.length - 1] === "") parts.pop();
    const [group, selRaw, totRaw] = parts;
    const selected = Number(selRaw);
    const total = Number(totRaw);
    // EXACTLY three fields. A row with extra ones used to keep the first three and
    // discard the rest, so a spreadsheet paste carrying thousands separators
    // ("Women, 1,200, 5,000") parsed as 1/200 — silently, with no malformed warning —
    // and a genuine 0.50 ratio rendered as a green "no adverse impact" verdict.
    // An empty numeric field (`Number("")` === 0) is a typo, not a real 0 — flag it
    // rather than fabricating a count, so the row is visible instead of assumed.
    if (parts.length !== 3 || !group || selRaw === "" || totRaw === "" || !Number.isFinite(selected) || !Number.isFinite(total)) {
      malformedRows.push(i + 1);
      continue;
    }
    groups.push({ group, selected, total });
  }
  return { groups, malformedRows, nonBlankRows: groups.length + malformedRows.length };
}

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
   *  meeting {@link ADVERSE_IMPACT_MIN_COHORT} can be the reference, and EXACTLY one
   *  row carries it — even when two pasted rows share a group name. */
  isReference: boolean;
  /** True when this group's own sample (total) meets {@link ADVERSE_IMPACT_MIN_COHORT}.
   *  When false the UI must render an "insufficient sample" state — NOT a verdict. */
  reliable: boolean;
  /** Selections this group is short of the reference RATE: referenceRate × total −
   *  selected, 0 at or above it. A count of people, so it grows with N exactly as a
   *  p-value shrinks: 40 short is noise across 100,000 applicants and decisive across
   *  100. Read it as a share of the group (shortfall ÷ total) beside the p-value, never
   *  alone. null where there is no ratio, and on the reference row. */
  shortfall: number | null;
  /** Two-sided mid-P exact p-value against the reference ({@link midPExactTwoSided}).
   *  null where there is no ratio, and on the reference row. */
  pValue: number | null;
  /** pValue < {@link SIGNIFICANCE_ALPHA}. A ratio below 0.8 that is not significant is
   *  a pattern to watch, not a finding; a significant gap above 0.8 is still a gap. */
  significant: boolean;
};

export type AdverseImpactResult = {
  groups: GroupImpact[];
  /** The reference (highest-rate) group's name, or null when none qualifies. */
  referenceGroup: string | null;
  /** True when any group falls below the four-fifths threshold. */
  anyAdverseImpact: boolean;
  /** True when a group is below the threshold AND its gap is statistically significant. */
  anySignificantAdverse: boolean;
  /** True when a group clears the threshold but still selects significantly less often
   *  than the reference: the large-sample gap the four-fifths screen alone misses. */
  anySignificantGapAboveThreshold: boolean;
  /** Rows that could not be assessed (below the floor). A headline that says "no group
   *  falls below" must also say how many groups it never measured. */
  unassessedGroups: number;
  /** {@link detectableRatio} of the LEAST sensitive comparison made — the gap below which
   *  a non-significant verdict says nothing. null when no comparison was made. */
  detectableRatio: number | null;
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
  // Tracked by INDEX, not by name: two pasted rows can carry the SAME group name, and
  // matching the reference back by `g.group === reference.group` marked BOTH of them
  // `isReference` — which exempts a row from ever being flagged. A duplicate "Women"
  // row at a 0.25 ratio rendered as "reference" under a green verdict.
  let referenceIndex = -1;
  for (let i = 0; i < withRate.length; i++) {
    if (!withRate[i].reliable) continue;
    if (referenceIndex < 0 || withRate[i].selectionRate > withRate[referenceIndex].selectionRate) referenceIndex = i;
  }
  const reference = referenceIndex >= 0 ? withRate[referenceIndex] : null;
  const referenceRate = reference?.selectionRate ?? 0;

  // The analysis is only trustworthy with a reference PLUS at least one other group
  // that clears the floor to measure against it.
  const reliableCount = withRate.filter((g) => g.reliable).length;
  const reliable = reliableCount >= 2;

  const groups: GroupImpact[] = withRate.map((g, i) => {
    const isReference = i === referenceIndex; // only ever a reliable row (see the loop above)
    // A ratio needs a reference WITH a positive rate, and the group itself must clear
    // the floor — otherwise it's undefined / unreliable, not "no adverse impact".
    const ratioMeasurable = reference !== null && referenceRate > 0 && g.reliable;
    const impactRatio = ratioMeasurable ? g.selectionRate / referenceRate : null;
    const adverseImpact = impactRatio !== null && !isReference && impactRatio < FOUR_FIFTHS;
    const compared = impactRatio !== null && !isReference && reference !== null;
    const shortfall = compared ? Math.max(0, referenceRate * g.total - g.selected) : null;
    const pValue = compared ? midPExactTwoSided(g.selected, g.total, reference.selected, reference.total) : null;
    return {
      group: g.group,
      selected: g.selected,
      total: g.total,
      selectionRate: g.selectionRate,
      impactRatio,
      adverseImpact,
      isReference,
      reliable: g.reliable,
      shortfall,
      pValue,
      significant: pValue !== null && pValue < SIGNIFICANCE_ALPHA,
    };
  });

  // The least sensitive comparison bounds what a non-significant verdict can claim.
  const detectable = reference
    ? groups
        .filter((g) => g.pValue !== null)
        .map((g) => detectableRatio(referenceRate, reference.total, g.total))
        .filter((d): d is number => d !== null)
    : [];
  const weakestDetectable = detectable.length > 0 ? Math.min(...detectable) : null;

  return {
    groups,
    referenceGroup: reference?.group ?? null,
    anyAdverseImpact: reliable && groups.some((g) => g.adverseImpact),
    anySignificantAdverse: reliable && groups.some((g) => g.adverseImpact && g.significant),
    anySignificantGapAboveThreshold:
      reliable && groups.some((g) => !g.adverseImpact && g.significant && (g.shortfall ?? 0) > 0),
    unassessedGroups: groups.filter((g) => !g.reliable).length,
    detectableRatio: reliable ? weakestDetectable : null,
    reliable,
  };
}
