// The ONE median in this codebase.
//
// WHY IT EXISTS: four independent implementations had grown — source-analytics'
// `medianHours`, db/analytics' `medianRounded`, llm-quality's local `median` and
// the insights matrix' `columnStats` — and they disagreed on the two questions a
// median actually has to answer:
//
//   • EVEN COUNTS. Three averaged the two middle values; llm-quality took the
//     UPPER middle. On [10, 20] that is 15 vs 20 — a 33% difference in a latency
//     figure a reader compares models by.
//   • VALIDITY. One dropped non-finite samples, two sorted them into the middle
//     (NaN sorts unpredictably and can BECOME the median), and one answered 0 for
//     an empty sample — a number that reads as a measurement when the honest
//     answer is "nothing was measured".
//
// The policy, stated once so every surface inherits it:
//
//   1. NON-FINITE SAMPLES ARE DROPPED. NaN and ±Infinity are malformed inputs
//      (clock skew, a divide-by-zero upstream), not extreme observations. They are
//      removed before sorting — never clamped, and never allowed to sort into the
//      middle. Domain filters beyond finiteness (a duration must be >= 0, a score
//      must be in 0..100) belong at the CALL SITE, which is the only place that
//      knows the domain.
//   2. EMPTY (or wholly invalid) ⇒ null, never 0. "No sample" and "a sample whose
//      median is zero" are different facts and the caller must be able to tell
//      them apart; every consumer here renders null as "—"/"no data".
//   3. EVEN COUNTS TAKE THE ARITHMETIC MEAN of the two middle values — the
//      textbook definition, and the one three of the four sites already used. It
//      is the tie policy because it is symmetric: neither middle observation is
//      privileged, so reversing the sample cannot move the answer.
//   4. The result is EXACT — no rounding, no unit conversion. Presentation
//      precision is a per-surface decision (0.1h here, whole days there, a floor
//      on the matrix so a band-straddling pair never rounds UP across a
//      threshold), so each caller applies its own and states why.
//   5. The input is never mutated: the sort runs on a copy, numerically.

/**
 * The median of a numeric sample under the policy above: non-finite values
 * dropped, empty ⇒ null, even counts averaged, exact and unrounded.
 *
 * @param values any numeric sample, in any order (not mutated)
 */
export function median(values: readonly number[]): number | null {
  const valid: number[] = [];
  for (const v of values) if (Number.isFinite(v)) valid.push(v);
  if (valid.length === 0) return null;
  valid.sort((a, b) => a - b);
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 0 ? (valid[mid - 1] + valid[mid]) / 2 : valid[mid];
}
