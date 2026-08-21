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
