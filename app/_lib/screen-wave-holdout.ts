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
// Pure so it is unit-testable under bare `node --test`: its one import is hash.ts,
// which is itself pure and dependency-free.

import { fnv1a } from "./hash";

/** FNV-1a, 32-bit, as a number — the repo's ONE non-cryptographic string hash
 *  (`app/_lib/hash.ts`), read back off its hex digest.
 *
 *  This module used to carry a fourth private copy of the algorithm, written in the
 *  shift-add form (`h + ((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24))`, i.e. `h * 16777619`)
 *  rather than `Math.imul`. The two are digest-identical — same 32 bits, only the
 *  arithmetic differs — and `holdout-hash-parity.test.ts` proves it over the exact
 *  `<jobId>:<entryId>` key shape rather than asserting it. That proof is what makes
 *  the fold safe HERE and nowhere else in the repo: this digest does not key a cache
 *  that can be re-warmed, it assigns HOLDOUT MEMBERSHIP. A digest change would move
 *  which candidates a live wave spares, break the preview/commit approval token
 *  (every commit 409s on "the candidate set changed"), and silently retire the clean
 *  arm the calibration figures are already computed against.
 *
 *  `hash.ts` states its own stability contract for the same class of reason, so the
 *  pin now lives once instead of in four places that could each drift alone. */
function hash32(input: string): number {
  return parseInt(fnv1a(input), 16);
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
