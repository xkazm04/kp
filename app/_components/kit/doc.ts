/*
 * The calm document's pure half (Gate 2, the candidate token pages /offer and /skill): the class an
 * outcome block wears and the width a score bar draws. Pure, so both are pinned by node:test.
 */

/** An outcome's tone: `ok` is the moss wash (an accepted offer); everything else is the quiet plane. */
export type OutcomeTone = "default" | "ok";

export function outcomeClass(tone: OutcomeTone = "default"): string {
  return tone === "ok" ? "k-result k-result--ok" : "k-result";
}

/** A 0..100 score as the bar's clamped width in percent (NaN draws nothing, never a full bar). */
export function scorePct(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}

/** The bar's class: a zero score keeps a visible baseline tick so an empty bar reads "low", not "missing". */
export function scoreBarClass(score: number): string {
  return scorePct(score) > 0 ? "k-scores__bar" : "k-scores__bar is-zero";
}
