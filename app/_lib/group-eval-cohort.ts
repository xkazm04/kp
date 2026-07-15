// Minimum-cohort floor for the comparative group evaluation, mirroring the SHAPE of
// adverse-impact.ts's ADVERSE_IMPACT_MIN_COHORT: a comparative verdict from too small a
// field is noise dressed as signal. bug-ui-scan-2026-07-09 #4: a SINGLE-candidate group
// crowned a "recommended lead over the field", reported EVERY skill as a "unique
// strength" (there are no rivals to be unique against), and trivially "passed" the
// weighting-robustness check (a length-1 order cannot reorder) — then auto-sealed all of
// that into the decision record. Below the floor there is no field to compare, so no lead
// is crowned/sealed and robustness is reported as "insufficient sample", not a pass.
//
// Pure + dependency-free (like adverse-impact.ts) so the gate is unit-testable without
// the DB that group-eval-run imports.

/**
 * The minimum number of compared candidates for a group evaluation to make any
 * COMPARATIVE claim — a recommended lead "over the field", a "unique" differentiator, or
 * a robust cross-scheme ranking. Two is the smallest field in which one candidate can be
 * ranked/differentiated AGAINST another; with one there is nothing to compare.
 *
 * NB this is a HEAD-TO-HEAD comparison floor, deliberately small — distinct from
 * adverse-impact.ts's ADVERSE_IMPACT_MIN_COHORT (n >= 30), which guards a statistical
 * SELECTION-RATE. A comparison's floor is simply "more than one thing to compare".
 */
export const GROUP_EVAL_MIN_COHORT = 2;

/**
 * The maximum number of candidates ONE comparative evaluation covers. The strongest
 * are selected by fit before the cap (top-N default), OR the recruiter picks an
 * explicit selection of up to this many (group-eval-cohort-choice). Single-sourced
 * here — a pure, client-safe module — so the server ranker (group-eval-run) and the
 * client selection UI (RoleDecisionRow) enforce the SAME bound without duplicating it.
 */
export const GROUP_EVAL_CAP = 6;

/**
 * True when the field is large enough to support a comparative verdict (a lead over the
 * field / differentiators / robustness). Below it the eval is "insufficient sample": the
 * lone candidate is still shown, but nothing comparative is asserted or sealed.
 */
export function hasComparableCohort(candidateCount: number): boolean {
  return candidateCount >= GROUP_EVAL_MIN_COHORT;
}
