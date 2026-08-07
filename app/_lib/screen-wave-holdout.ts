// Calibration holdout for the screening wave (UAT 2026-07-20, KAT-L1-001/002).
//
// THE PROBLEM THIS EXISTS TO SOLVE. `computeCalibration` pairs a candidate's match
// score against an outcome label in which `status='rejected'` is the negative
// case — but `runScreenWave` PRODUCES that rejection by testing the same score
// against a floor. The predictor causes its own label. That is textbook label
// leakage: a perfectly biased screener that simply favoured polished CVs would
// draw a near-perfect reliability diagram, and the Brier score is biased optimistic
// by an amount nothing estimates or discloses. Until some below-floor candidates
// are observed WITHOUT the score having acted on them, every claim about selection
// quality is unfalsifiable — including the one this UAT was run to test, whether
// the product picks the best candidate or the best-presenting one.
//
// The holdout is that clean arm: a small, random-but-STABLE sample of would-be
// auto-rejects that the wave spares, so their real outcomes can be compared
// against what the score predicted.
//
// WHY DETERMINISTIC, NOT RANDOM. Two hard constraints, both violated by Math.random:
//
//   1. The wave signs the exact reject set into an approval token at preview time
//      and re-derives it at commit (EU AI Act / GDPR Art. 22 human-approval gate).
//      A re-rolled holdout would change the set between the two, so every commit
//      would 409 "the candidate set changed since it was previewed".
//   2. Membership must not move when the recruiter adjusts a threshold, or the
//      slider becomes a re-roll button for un-sparing a specific person.
//
// So membership is a pure function of (jobId, entryId) — stable across previews,
// across threshold changes, and across process restarts, while still being
// unpredictable enough that it cannot be steered. It is deliberately NOT keyed on
// the policy version for constraint 2, and IS keyed on the role so one candidate
// isn't permanently in (or out of) the holdout everywhere.
//
// Pure and dependency-free so it is unit-testable under bare `node --test`.

/** FNV-1a, 32-bit. A small, fast, well-mixed non-cryptographic hash — this needs
 *  stable spread, not unpredictability against an adversary with the source. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h *= 16777619, in 32-bit space without overflowing the float mantissa.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Is this candidate in the calibration holdout for this role?
 *
 *  `percent` outside a sane range fails CLOSED to "not spared" — a malformed
 *  config must never silently spare an unbounded share of a reject wave. */
export function isHoldout(jobId: string, entryId: string, percent: number): boolean {
  if (!Number.isFinite(percent) || percent <= 0) return false;
  if (percent >= 100) return true;
  // 0..9999 for two decimal places of resolution on the percentage.
  const bucket = hash32(`${jobId}:${entryId}`) % 10_000;
  return bucket < percent * 100;
}

/** Split a would-reject set into the spared (calibration clean arm) and the
 *  still-rejected, preserving the caller's order in BOTH partitions — the wave
 *  renders rows in rank order and the human approves what they saw. */
export function selectHoldout(
  jobId: string,
  wouldRejectIds: readonly string[],
  percent: number
): { spared: string[]; rejected: string[] } {
  const spared: string[] = [];
  const rejected: string[] = [];
  for (const id of wouldRejectIds) {
    (isHoldout(jobId, id, percent) ? spared : rejected).push(id);
  }
  return { spared, rejected };
}
