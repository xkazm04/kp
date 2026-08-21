// The calibration trust verdict, as pure functions.
//
// WHY THIS FILE EXISTS: the structural bar below (a score-caused arm can never
// be called trustworthy) is the load-bearing guarantee of the KAT-ANA-1 fix, and
// it used to live inside `sections/QualityInstrument.tsx`. `npm run test:unit`
// runs node:test over `app/**/*.test.ts` and cannot import a `.tsx`, so the bar
// could only be pinned by a source-level contract test that reads the file as
// text. A guarantee asserted by grep is exactly the shape of defect this whole
// drain was about — machinery that is correct and unenforced. Moved here so the
// bar is pinned by an EXECUTING test (`calibrationVerdict.test.ts`).
//
// Keep this module free of React and of `next-intl`: the moment it imports
// either, it stops being testable and the bar goes back to being a comment.

import type { CalibrationLeakage, ThresholdEffect } from "@/app/_lib/calibration";

/** The slice of the calibration payload a verdict is derived from. */
export type CalibrationVerdictInput = {
  n: number;
  positives: number;
  brier: number | null;
  calibrated: boolean;
  minOutcomes: number;
  leakage?: CalibrationLeakage;
};

export type CalibrationSkill = {
  /** Share of the cohort that advanced (0..1). */
  baseRate: number | null;
  /** Brier score of the constant predictor "always say the base rate": p(1−p).
   *  THIS is what a screening score has to beat — not a coin flip. */
  baseBrier: number | null;
  /** Brier skill score, 1 − brier/baseBrier. 0 = no better than that constant
   *  guess; NEGATIVE = worse than it. Null when the cohort is degenerate (every
   *  outcome the same way), where no skill is measurable at all. */
  skill: number | null;
};

/** UAT LUC-ANA-2 — 0.25 is the Brier of a 50/50 coin flip, and a cohort that
 *  advances 86% of the time is nothing like a coin. Measured against its own base
 *  rate the seeded pipeline arm scores −0.332: WORSE than a constant guess, under
 *  a headline that claimed a comfortable margin over guessing. Pure. */
export function calibrationSkill(
  result: { n: number; positives: number; brier: number | null } | null | undefined
): CalibrationSkill {
  if (!result || result.n <= 0) return { baseRate: null, baseBrier: null, skill: null };
  const baseRate = result.positives / result.n;
  const baseBrier = baseRate * (1 - baseRate);
  const skill = baseBrier > 0 && result.brier != null ? 1 - result.brier / baseBrier : null;
  return { baseRate, baseBrier, skill };
}

// A Brier skill score of 0 means "no better than always predicting this cohort's
// base rate". This is the bar a screening score has to clear before anyone should
// let it auto-decide — 0.25 (a 50/50 coin) is the wrong yardstick for a cohort
// that advances 86 % of the time, and using it is what let a NEGATIVE skill score
// render as „a comfortable margin over guessing".
export const GOOD_SKILL = 0.2;

export type Verdict = "trustworthy" | "weak" | "untrustworthy" | "unknown" | "circular";

/**
 * The trust verdict for one calibration arm.
 *
 * The `level === "high"` branch is the STRUCTURAL bar demanded by KAT-ANA-1: it
 * sits above the skill ladder, so no Brier score — however good — can route a
 * score-caused arm to `trustworthy`. That is deliberately a property of this
 * function and not of the copy, because copy regresses and a decision table does
 * not. Do not move it below the ladder; `calibrationVerdict.test.ts` fails if you do.
 */
export function verdictFor(p: CalibrationVerdictInput | null | undefined): Verdict | null {
  if (p == null) return null;
  if (!p.calibrated || p.brier == null) return "unknown";
  const { skill } = calibrationSkill(p);
  // A degenerate cohort (every outcome the same way) has nothing to discriminate,
  // so no skill exists to report — that is "cannot tell you", not "weak".
  if (skill == null) return "unknown";
  if (p.leakage?.level === "high") return "circular";
  if (skill >= GOOD_SKILL) return "trustworthy";
  if (skill > 0) return "weak";
  return "untrustworthy";
}

// ---------------------------------------------------------------------------
// What the "Since the last change" line is allowed to claim.
//
// `computeThresholdEffect` gates only the AFTER side: `measurable` is
// `after != null && after.n >= minOutcomes`. The BEFORE side has no floor at all —
// `effectSide()` returns a side for a single pair — and `ThresholdEffectSide`
// says so in its own type: "advanceRatePct: 0..100 … always read ALONGSIDE n,
// never alone".
//
// The strip's `effectDelta` copy reads „Band {lo}–{hi} advance rate: {beforePct}%
// before → {afterPct}% after the change (n={n} since)", and the only n it prints is
// the AFTER one. So one in-band candidate decided before the apply, who advanced,
// renders as „100 % before → 50 % after": a policy-effect story about the live
// auto-reject floor whose first half is one person, with nothing on screen to say so.
//
// The bar is the module's own: `MIN_THRESHOLD_EFFECT_OUTCOMES` is already the
// "measure it" floor (and, per its comment, the same floor the recommendation
// itself is gated on). Applying it SYMMETRICALLY is not a new threshold — it is the
// existing one, applied to the side that was missing it. Below it the strip states
// the after-side figure alone, which it can defend, instead of a comparison it cannot.
//
// Resolved as a value (the `funnelBandState` idiom) so a node:test can pin which
// branch the strip takes; the component maps the branch to copy and nothing else.
// ---------------------------------------------------------------------------

/** Which sentence the effect block may print. `null` = no apply to measure against. */
export type ThresholdEffectClaim =
  /** Not enough in-band decisions SINCE the change — no rate is defensible yet. */
  | { kind: "too-few" }
  /** The after-side rate stands alone; the before side is absent or below the floor. */
  | { kind: "after-only"; after: { n: number; advanceRatePct: number } }
  /** Both sides clear the floor, so a before → after comparison is defensible. */
  | { kind: "delta"; before: { n: number; advanceRatePct: number }; after: { n: number; advanceRatePct: number } };

export function thresholdEffectClaim(effect: ThresholdEffect | null | undefined): ThresholdEffectClaim | null {
  if (effect == null) return null;
  // `measurable` already implies a non-null after side; the explicit check keeps the
  // narrowing local instead of resting on a non-null assertion at the render site.
  if (!effect.measurable || effect.after == null) return { kind: "too-few" };
  const after = { n: effect.after.n, advanceRatePct: effect.after.advanceRatePct };
  if (effect.before == null || effect.before.n < effect.minOutcomes) return { kind: "after-only", after };
  return { kind: "delta", before: { n: effect.before.n, advanceRatePct: effect.before.advanceRatePct }, after };
}
