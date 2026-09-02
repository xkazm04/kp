// The cross-scheme fairness matrix, read in lockstep — pure, so the arithmetic
// the bias-defensibility of this surface rests on is testable without a DOM.
//
// Both rules below were written inline in the client hook
// (jobsRecruiterCandidatesLogic.ts) and therefore untestable; the hook now calls
// these. Behaviour is unchanged — see jobsFairnessMatrix.test.ts for the pins.
import type { FairnessMatrix } from "./JobsTypes";

export type FairnessEntry = { own: number; mean: number; delta: number };

/** Index `own` / `mean` / `delta` by candidate id.
 *
 *  The gate spans EVERY parallel array, `own` included. It used to check
 *  `candidateIds` against `mean` only, while the body still read `own[i] ?? 0` —
 *  so a payload whose `own` was short (a truncated/altered blob; the type
 *  asserts the alignment, nothing enforces it across the Python→JSON boundary)
 *  fabricated an own-score of 0 and a delta of `mean − 0`: a full-mean "robustly
 *  under-rated by their own weights" advantage, invented. A matrix we cannot
 *  read in lockstep is not a check — the empty map degrades the caller to
 *  `hasFairness === false` (no Fair Rank toggle, no audit panel), the same
 *  honest "not assessed" stance assessRobustness takes for the group eval. */
export function indexFairnessMatrix(fairness: FairnessMatrix | null | undefined): Map<string, FairnessEntry> {
  const byId = new Map<string, FairnessEntry>();
  const ids = fairness?.candidateIds;
  if (
    !fairness ||
    !ids ||
    !Array.isArray(fairness.own) ||
    !Array.isArray(fairness.mean) ||
    ids.length !== fairness.own.length ||
    ids.length !== fairness.mean.length
  ) {
    return byId;
  }
  ids.forEach((cid, i) => {
    const own = fairness.own[i];
    const mean = fairness.mean[i];
    byId.set(cid, { own, mean, delta: mean - own });
  });
  return byId;
}

/** The exported audit record's DATA rows (the header is the caller's, because it
 *  is localized): `[label, own, robust, delta, ...per-scheme scores]`.
 *
 *  Same lockstep rule applied to the record: a delta is only written when BOTH
 *  sides of it exist. `(mean[i] ?? 0) - (own[i] ?? 0)` used to print a full-mean
 *  advantage for a row missing its own-score (and a flat 0 — "perfectly robust" —
 *  for a row missing both), which is exactly the fabricated number a compliance
 *  reviewer opens the CSV to rule out. */
export function fairnessCsvRows(fairness: FairnessMatrix | null | undefined): (string | number)[][] {
  if (!fairness) return [];
  return fairness.labels.map((label, i) => {
    const own = fairness.own?.[i];
    const mean = fairness.mean?.[i];
    const bothKnown = typeof own === "number" && typeof mean === "number";
    return [label, own ?? "", mean ?? "", bothKnown ? mean - own : "", ...(fairness.matrix[i] ?? [])];
  });
}
