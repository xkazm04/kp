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
   *  reference (no group has any applicants, or the reference rate is 0). */
  impactRatio: number | null;
  /** True when impactRatio < {@link FOUR_FIFTHS}. The reference group itself is
   *  never flagged (its ratio is 1). */
  adverseImpact: boolean;
  /** The highest-selection-rate group the others are measured against. */
  isReference: boolean;
};

export type AdverseImpactResult = {
  groups: GroupImpact[];
  /** The reference (highest-rate) group's name, or null when none qualifies. */
  referenceGroup: string | null;
  /** True when any group falls below the four-fifths threshold. */
  anyAdverseImpact: boolean;
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
 * selection rate among groups that actually had applicants (total > 0); ties pick
 * the first such group in input order (deterministic). Groups with no applicants
 * carry a null ratio and are never flagged or used as the reference. If no group
 * has applicants, or the reference rate is 0 (nobody was selected anywhere), every
 * ratio is null and nothing is flagged — there is no impact to measure.
 */
export function computeAdverseImpact(rawGroups: readonly GroupCount[]): AdverseImpactResult {
  const cleaned = rawGroups.map(clampCounts);
  const withRate = cleaned.map((g) => ({
    ...g,
    selectionRate: g.total > 0 ? g.selected / g.total : 0,
  }));

  // Reference = highest selection rate among groups that had applicants.
  let reference: (typeof withRate)[number] | null = null;
  for (const g of withRate) {
    if (g.total <= 0) continue;
    if (reference === null || g.selectionRate > reference.selectionRate) reference = g;
  }
  const referenceRate = reference?.selectionRate ?? 0;

  const groups: GroupImpact[] = withRate.map((g) => {
    const isReference = reference !== null && g.group === reference.group && g.total > 0;
    // A ratio needs a reference WITH a positive rate, and the group itself needs
    // applicants — otherwise it's undefined, not "no adverse impact".
    const ratioMeasurable = reference !== null && referenceRate > 0 && g.total > 0;
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
    };
  });

  return {
    groups,
    referenceGroup: reference?.group ?? null,
    anyAdverseImpact: groups.some((g) => g.adverseImpact),
  };
}
