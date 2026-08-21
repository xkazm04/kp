// Executing coverage for the calibration trust verdict (UAT KAT-ANA-1 / LUC-ANA-2).
//
// The bar this pins: a calibration arm whose LABEL WAS PRODUCED BY THE SCORE
// (`leakage.level === "high"`) can never be reported as trustworthy, no matter
// how good its Brier score looks. That is the whole KAT-L1-001 fix reaching a
// reader — and until `verdictFor` moved out of a `.tsx`, it could only be
// asserted by reading source text.

import test from "node:test";
import assert from "node:assert/strict";
import {
  calibrationSkill,
  thresholdEffectClaim,
  verdictFor,
  GOOD_SKILL,
  type CalibrationVerdictInput,
} from "./calibrationVerdict";
import type { ThresholdEffect } from "@/app/_lib/calibration";

const arm = (over: Partial<CalibrationVerdictInput> = {}): CalibrationVerdictInput => ({
  n: 21,
  positives: 18,
  brier: 0.163,
  calibrated: true,
  minOutcomes: 20,
  ...over,
});

const HIGH = { level: "high", code: "score-caused-label", note: "", ceiling: "" } as const;
const LOW = { level: "low", code: "no-automated-leakage", note: "", ceiling: "" } as const;
// UAT KAT-L1-003 — the hire axis of the pipeline arm. A DIFFERENT code (its
// positive label is a chain of human decisions), the SAME level (its negatives
// still contain every auto-rejection the score produced).
const HIRE = { level: "high", code: "score-caused-rejects", note: "", ceiling: "" } as const;

// ─── the honest yardstick ─────────────────────────────────────────────────────

test("skill is measured against the cohort base rate, not a coin flip", () => {
  // The live seeded host, exactly: 21 decided, 18 advanced, Brier 0.1631.
  const { baseRate, baseBrier, skill } = calibrationSkill({ n: 21, positives: 18, brier: 0.1631 });
  assert.ok(baseRate != null && Math.abs(baseRate - 18 / 21) < 1e-9);
  // p(1−p) for an 86%-advance cohort is 0.1224 — nothing like a coin's 0.25.
  assert.ok(baseBrier != null && Math.abs(baseBrier - 0.1224489795918367) < 1e-9);
  // …so the arm the screen called "well calibrated" is WORSE than a constant guess.
  assert.ok(skill != null && skill < 0);
  assert.ok(Math.abs(skill - -0.3316) < 0.001, `expected ≈ -0.332, got ${skill}`);
});

test("a degenerate cohort reports no skill rather than a bad one", () => {
  // Everyone advanced: nothing to discriminate, so skill is unmeasurable.
  assert.equal(calibrationSkill({ n: 10, positives: 10, brier: 0.1 }).skill, null);
  assert.equal(calibrationSkill({ n: 0, positives: 0, brier: null }).baseRate, null);
  assert.equal(calibrationSkill(null).skill, null);
});

// ─── the structural bar ───────────────────────────────────────────────────────

test("a high-leakage arm is circular even with a PERFECT Brier score", () => {
  // This is the assertion the whole item exists for. A score-caused label can
  // manufacture an arbitrarily good number; the verdict must not be derivable
  // from that number.
  const perfect = arm({ brier: 0, leakage: HIGH });
  assert.ok(calibrationSkill(perfect).skill! >= GOOD_SKILL, "precondition: skill clears the good bar");
  assert.equal(verdictFor(perfect), "circular");
});

test("the leakage bar sits ABOVE the skill ladder, for every rung", () => {
  // Order property: whatever the ladder would have said, high leakage wins.
  for (const brier of [0, 0.05, 0.1224, 0.163, 0.3, 0.9]) {
    assert.equal(verdictFor(arm({ brier, leakage: HIGH })), "circular", `brier=${brier}`);
  }
});

test("only a clean arm can ever reach trustworthy", () => {
  const clean = arm({ n: 40, positives: 20, brier: 0.05, leakage: LOW });
  assert.ok(calibrationSkill(clean).skill! >= GOOD_SKILL);
  assert.equal(verdictFor(clean), "trustworthy");

  // …and the identical numbers with a score-caused label do not.
  assert.equal(verdictFor({ ...clean, leakage: HIGH }), "circular");
});

// ─── the ladder itself ────────────────────────────────────────────────────────

test("the ladder grades a clean arm honestly", () => {
  // n=40, positives=20 → baseRate .5, baseBrier .25.
  const clean = (brier: number) => verdictFor(arm({ n: 40, positives: 20, brier, leakage: LOW }));
  assert.equal(clean(0.05), "trustworthy"); // skill 0.80
  assert.equal(clean(0.24), "weak"); // skill 0.04 — positive but under the bar
  assert.equal(clean(0.25), "untrustworthy"); // skill 0 — no better than guessing
  assert.equal(clean(0.4), "untrustworthy"); // skill < 0 — worse than guessing
});

// ─── the hire axis rides the SAME bar (UAT KAT-L1-003) ────────────────────────

test("the structural bar is keyed on the LEVEL, so a new arm cannot slip under it", () => {
  // The hire axis was added with its own leakage CODE. If the bar had been written
  // against the code instead of the level, that new code would have walked straight
  // past it to `trustworthy` on a good Brier. It is not, and this is why.
  const perfect = arm({ brier: 0, leakage: HIRE });
  assert.ok(calibrationSkill(perfect).skill! >= GOOD_SKILL, "precondition: skill clears the good bar");
  assert.equal(verdictFor(perfect), "circular");
  for (const brier of [0, 0.05, 0.163, 0.9]) {
    assert.equal(verdictFor(arm({ brier, leakage: HIRE })), "circular", `brier=${brier}`);
  }
});

test("a low base rate is measured honestly, not flattered", () => {
  // A hire cohort is small and mostly negative. 1 hire in 20 → base rate 0.05,
  // baseBrier 0.0475: the constant predictor is ALREADY very good, so a 0-100 match
  // score read as a hire probability has to be much better than the coin-flip
  // intuition suggests. The skill score must report that, however ugly it looks.
  const { baseRate, baseBrier, skill } = calibrationSkill({ n: 20, positives: 1, brier: 0.45 });
  assert.ok(baseRate != null && Math.abs(baseRate - 0.05) < 1e-9);
  assert.ok(baseBrier != null && Math.abs(baseBrier - 0.0475) < 1e-9);
  assert.ok(skill != null && skill < -8, `a badly miscalibrated hire arm must read very negative, got ${skill}`);
  // …and the verdict follows the arithmetic, not the size of the number.
  assert.equal(verdictFor({ n: 20, positives: 1, brier: 0.45, calibrated: true, minOutcomes: 20, leakage: LOW }), "untrustworthy");

  // The inverse trap: a tiny positive count must not make a good-looking Brier read
  // as skill. Predicting ~0.05 everywhere beats the base-rate predictor only barely.
  const nearBase = calibrationSkill({ n: 20, positives: 1, brier: 0.0475 });
  assert.ok(Math.abs(nearBase.skill!) < 1e-9, "matching the base rate is zero skill, not a win");
  assert.equal(
    verdictFor({ n: 20, positives: 1, brier: 0.0475, calibrated: true, minOutcomes: 20, leakage: LOW }),
    "untrustworthy",
    "no better than the constant guess is not 'weak', it is 'no better'"
  );
});

test("the honesty gate is per arm: the hire arm's own count decides", () => {
  // The hire axis fills far more slowly than the advance axis (everyone still in
  // the process is excluded), so it will sit below the gate long after the advance
  // arm has cleared it. The gate reads THIS arm's n, never the workspace's.
  assert.equal(verdictFor({ n: 9, positives: 6, brier: 0.2, calibrated: false, minOutcomes: 20, leakage: HIRE }), "unknown");
  assert.equal(verdictFor({ n: 20, positives: 6, brier: 0.2, calibrated: true, minOutcomes: 20, leakage: HIRE }), "circular");
});

// ─── the "since the last change" claim ────────────────────────────────────────
//
// `computeThresholdEffect` floors only the AFTER side (`measurable`). The BEFORE
// side is whatever `effectSide()` found, down to a single pair, and the strip's
// `effectDelta` copy prints exactly one n — the after one. These pin that a
// before side thinner than the effect floor cannot be dressed up as the first half
// of a before → after comparison.

const effect = (over: Partial<ThresholdEffect> = {}): ThresholdEffect => ({
  band: { lo: 40, hi: 48 },
  appliedAt: "2026-08-11T08:42:49.956Z",
  before: { n: 9, advanced: 6, advanceRatePct: 67 },
  after: { n: 12, advanced: 6, advanceRatePct: 50 },
  measurable: true,
  minOutcomes: 8,
  ...over,
});

test("a single decision before the apply is not the 'before' half of a policy effect", () => {
  // The exact shape: one in-band candidate decided before the floor moved, who
  // advanced. Left ungated it renders „100 % before → 50 % after the change (n=12
  // since)" — a policy-effect story whose first figure is one person, with no n on
  // screen to say so.
  const thin = effect({ before: { n: 1, advanced: 1, advanceRatePct: 100 } });
  const claim = thresholdEffectClaim(thin);
  assert.equal(claim?.kind, "after-only", "a 1-sample before side cannot license a comparison");
  assert.deepEqual(claim?.kind === "after-only" ? claim.after : null, { n: 12, advanceRatePct: 50 });

  // The boundary is the module's own floor, and it is inclusive on both sides —
  // exactly the bar `measurable` applies to the after side.
  assert.equal(thresholdEffectClaim(effect({ before: { n: 7, advanced: 4, advanceRatePct: 57 } }))?.kind, "after-only");
  assert.equal(thresholdEffectClaim(effect({ before: { n: 8, advanced: 4, advanceRatePct: 50 } }))?.kind, "delta");
});

test("both sides over the floor still get their comparison", () => {
  const claim = thresholdEffectClaim(effect());
  assert.equal(claim?.kind, "delta");
  assert.deepEqual(claim?.kind === "delta" ? claim.before : null, { n: 9, advanceRatePct: 67 });
  assert.deepEqual(claim?.kind === "delta" ? claim.after : null, { n: 12, advanceRatePct: 50 });
});

test("an unmeasurable or absent effect claims nothing at all", () => {
  assert.equal(thresholdEffectClaim(null), null, "no apply to measure against");
  assert.equal(thresholdEffectClaim(undefined), null);
  assert.equal(thresholdEffectClaim(effect({ measurable: false }))?.kind, "too-few");
  // `measurable` already implies an after side; a payload that disagrees with itself
  // must fall to the refusal, never to an assertion built on a missing side.
  assert.equal(thresholdEffectClaim(effect({ after: null, measurable: true }))?.kind, "too-few");
  // No earlier in-band decision at all is the after-only case it always was.
  assert.equal(thresholdEffectClaim(effect({ before: null }))?.kind, "after-only");
});

test("an unjudgeable arm says so instead of guessing", () => {
  assert.equal(verdictFor(null), null);
  assert.equal(verdictFor(undefined), null);
  // The clean arms on the seeded host: real, reachable, and empty.
  assert.equal(verdictFor(arm({ n: 0, positives: 0, brier: null, calibrated: false })), "unknown");
  // Enough rows but the gate has not opened yet.
  assert.equal(verdictFor(arm({ calibrated: false })), "unknown");
  // Calibrated but no score computed.
  assert.equal(verdictFor(arm({ brier: null })), "unknown");
});
