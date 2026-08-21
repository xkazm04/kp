// Shared draft/slot types for ArchetypeManager and its view/edit panels, plus the
// pure weight-percentage rules both of them apply. The rules live here (a plain .ts
// with no React/JSX) so they have ONE home and are unit-testable —
// ArchetypeManagerTypes.test.ts pins them.
export type Slot = "skills" | "career" | "personal";
export const SLOTS: Slot[] = ["skills", "career", "personal"];

export type Draft = {
  id: string;
  label: string;
  badge: string;
  applyLabel: string;
  scoringModel: string;
  fairnessProtected: boolean;
  pct: Record<Slot, number>; // weights as whole-number percentages
  dim: Record<Slot, string>;
};

/**
 * Clamp a typed weight percentage into [0, 100].
 *
 * `min={0} max={100}` on the edit panel's number input is ADVISORY: Save is a click
 * handler, not a form submit, so nothing in the browser enforces them. A NEGATIVE
 * percentage still passes the "must total 100%" check whenever a sibling compensates
 * (-10 / 60 / 50 totals 100), and was posted as a weight of -0.1. The headline score is
 * `100 * (w.skills*skills + w.career*career + w.personal*personal)` — a weighted AVERAGE
 * only while every weight is a share in [0,1] — so a negative weight SUBTRACTS its
 * dimension and the candidate with the STRONGER skills evidence scores lower.
 * archetype-registry.validateArchetype now refuses it at the API boundary
 * (`weight_out_of_range`), but that code has no message-catalog entry yet, so the
 * manager can only render the generic "Save failed (400)." — a refusal the operator
 * cannot act on. Clamping on the way in makes the bound binding where it is legible:
 * the field shows the number that will actually be saved, and the existing localized
 * sum error takes over from there.
 */
export function clampWeightPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** The three slot percentages summed. A non-numeric slot counts as 0 rather than
 *  poisoning the total with NaN (which would compare false against everything and
 *  disable Save with no explanation). */
export function weightPctSum(pct: Record<Slot, number>): number {
  return SLOTS.reduce((n, s) => n + (Number(pct[s]) || 0), 0);
}

/** How far a percentage total may sit from 100 and still count as 100. See
 *  weightPctSumOk — deliberately ~5 orders tighter than the registry's own
 *  `WEIGHT_SUM_TOLERANCE` (1e-6 on the /100 scale, i.e. 1e-4 here). */
export const WEIGHT_PCT_TOLERANCE = 1e-9;

/**
 * Does a percentage total satisfy the registry's weight-sum invariant?
 *
 * NOT `sum === 100`. The inputs accept decimals and binary floating point cannot
 * represent tenths exactly: 5.1 + 64.1 + 30.8 is 99.99999999999999, and an exact test
 * rejected 8.2% of ALL one-decimal splits that add up on paper. The operator then read
 * "Weights must total 100% (currently 100%)" — ICU rounds the interpolated number — over
 * a permanently disabled Save button, with nothing to act on.
 *
 * Admitting 1e-9 here cannot loosen the real contract: the manager divides by 100 before
 * posting, so a total this predicate accepts is within 1e-11 of 1.0, far inside both
 * validateArchetype's 1e-6 and Python's identical import-time guard
 * (registry._validate_archetype_weights, which runs on EVERY pipeline spawn). It absorbs
 * float-representation noise only — 99.9 is still refused.
 */
export function weightPctSumOk(sum: number): boolean {
  return Math.abs(sum - 100) <= WEIGHT_PCT_TOLERANCE;
}

/** The total as it should be PRINTED: exactly 100 when it counts as 100 (never
 *  "99.99999999999999%" in the header), otherwise the de-noised real total so the
 *  "currently {pct}%" message names a number the operator can reconcile. */
export function displayWeightPct(sum: number): number {
  return weightPctSumOk(sum) ? 100 : Number(sum.toFixed(6));
}
