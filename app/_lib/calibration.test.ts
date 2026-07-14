import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCalibration,
  computeCalibrationCohorts,
  recommendScreeningThreshold,
  MIN_CALIBRATION_OUTCOMES,
  MIN_CALIBRATION_BAND_OUTCOMES,
  CALIBRATION_BIN_COUNT,
  type ScoreOutcome,
  type ScoreOutcomeAt,
} from "./calibration.ts";

test("empty input: n=0, brier null, not calibrated, ten empty bins", () => {
  const r = computeCalibration([]);
  assert.equal(r.n, 0);
  assert.equal(r.positives, 0);
  assert.equal(r.brier, null);
  assert.equal(r.calibrated, false);
  assert.equal(r.bins.length, CALIBRATION_BIN_COUNT);
  assert.ok(r.bins.every((b) => b.count === 0 && b.predicted === 0 && b.observed === 0));
});

test("a perfectly-confident-and-correct set has Brier 0", () => {
  // score 100 -> prob 1 -> outcome 1; score 0 -> prob 0 -> outcome 0.
  const pairs: ScoreOutcome[] = [
    { score: 100, outcome: 1 },
    { score: 0, outcome: 0 },
    { score: 100, outcome: 1 },
    { score: 0, outcome: 0 },
  ];
  const r = computeCalibration(pairs, 1);
  assert.equal(r.n, 4);
  assert.equal(r.positives, 2);
  assert.equal(r.brier, 0);
  assert.equal(r.calibrated, true);
});

test("an overconfident-wrong set has Brier 1 (max error)", () => {
  // Predicts 100% but the outcome is always 0 (and vice-versa) -> (1-0)^2 = 1.
  const pairs: ScoreOutcome[] = [
    { score: 100, outcome: 0 },
    { score: 0, outcome: 1 },
  ];
  const r = computeCalibration(pairs, 1);
  assert.equal(r.brier, 1);
});

test("prob === 1 (score 100) lands in the LAST bin, not an 11th", () => {
  const r = computeCalibration([{ score: 100, outcome: 1 }], 1);
  assert.equal(r.bins.length, CALIBRATION_BIN_COUNT);
  assert.equal(r.bins[CALIBRATION_BIN_COUNT - 1].count, 1);
  assert.equal(r.bins[CALIBRATION_BIN_COUNT - 1].observed, 1);
});

test("observed rate per bin reflects the real positive fraction", () => {
  // Four scores in the [70,80) bin: 3 advanced, 1 passed -> observed 0.75.
  const pairs: ScoreOutcome[] = [
    { score: 72, outcome: 1 },
    { score: 74, outcome: 1 },
    { score: 76, outcome: 1 },
    { score: 78, outcome: 0 },
  ];
  const r = computeCalibration(pairs, 1);
  const bin = r.bins[7]; // [0.7, 0.8)
  assert.equal(bin.count, 4);
  assert.equal(bin.observed, 0.75);
  assert.ok(Math.abs(bin.predicted - 0.75) < 1e-9); // mean of .72/.74/.76/.78
});

test("calibrated flag respects the minimum-outcomes gate (default + override)", () => {
  const few = Array.from({ length: MIN_CALIBRATION_OUTCOMES - 1 }, () => ({ score: 50, outcome: 1 }));
  assert.equal(computeCalibration(few).calibrated, false);
  const enough = Array.from({ length: MIN_CALIBRATION_OUTCOMES }, () => ({ score: 50, outcome: 1 }));
  assert.equal(computeCalibration(enough).calibrated, true);
  assert.equal(computeCalibration(few, 5).calibrated, true); // override lowers the bar
});

test("non-finite / out-of-range scores are clamped, never NaN", () => {
  const r = computeCalibration(
    [
      { score: Number.NaN, outcome: 1 },
      { score: 150, outcome: 1 },
      { score: -20, outcome: 0 },
    ],
    1
  );
  assert.ok(r.brier !== null && Number.isFinite(r.brier));
  assert.equal(r.bins[0].count, 2); // NaN->0 and -20->0 both land in bin 0
  assert.equal(r.bins[CALIBRATION_BIN_COUNT - 1].count, 1); // 150 clamps to prob 1 -> last bin
});

test("outcome is coerced to 0/1 around 0.5", () => {
  const r = computeCalibration(
    [
      { score: 80, outcome: 0.9 },
      { score: 80, outcome: 0.2 },
    ],
    1
  );
  assert.equal(r.positives, 1);
});

// ─── Drift cohorts (Direction 1) ──────────────────────────────────────────────

test("cohorts bucket by calendar quarter (UTC), ascending", () => {
  const pairs: ScoreOutcomeAt[] = [
    { score: 80, outcome: 1, at: "2026-05-10T12:00:00.000Z" }, // Q2
    { score: 40, outcome: 0, at: "2026-02-01T00:00:00.000Z" }, // Q1
    { score: 60, outcome: 1, at: "2026-04-30T23:00:00.000Z" }, // Q2
  ];
  const cohorts = computeCalibrationCohorts(pairs, 1);
  assert.deepEqual(cohorts.map((c) => c.key), ["2026-Q1", "2026-Q2"]);
  assert.equal(cohorts[0].n, 1);
  assert.equal(cohorts[1].n, 2);
  assert.equal(cohorts[0].quarter, 1);
  assert.equal(cohorts[1].quarter, 2);
});

test("a cohort below the gate reports n but NO brier (honest per cohort)", () => {
  // Five decided candidates in one quarter, gate at 20 → not calibrated.
  const pairs: ScoreOutcomeAt[] = Array.from({ length: 5 }, (_, i) => ({
    score: 70,
    outcome: i % 2,
    at: "2026-07-05T00:00:00.000Z",
  }));
  const [c] = computeCalibrationCohorts(pairs); // default gate = 20
  assert.equal(c.n, 5);
  assert.equal(c.calibrated, false);
  assert.equal(c.brier, null, "no Brier drawn on a handful of points");
});

test("a cohort at/above the gate reports its brier", () => {
  const pairs: ScoreOutcomeAt[] = Array.from({ length: MIN_CALIBRATION_OUTCOMES }, () => ({
    score: 100,
    outcome: 1,
    at: "2026-01-15T00:00:00.000Z",
  }));
  const [c] = computeCalibrationCohorts(pairs);
  assert.equal(c.calibrated, true);
  assert.equal(c.brier, 0);
});

test("malformed / empty timestamps are excluded from the time view, not misbucketed", () => {
  const pairs: ScoreOutcomeAt[] = [
    { score: 80, outcome: 1, at: "not-a-date" },
    { score: 80, outcome: 1, at: "" },
    { score: 80, outcome: 1, at: "2026-03-01T00:00:00.000Z" },
  ];
  const cohorts = computeCalibrationCohorts(pairs, 1);
  assert.equal(cohorts.length, 1);
  assert.equal(cohorts[0].n, 1);
});

// ─── Threshold recommendation (Direction 3) ───────────────────────────────────

function bandPairs(score: number, positives: number, negatives: number): ScoreOutcome[] {
  return [
    ...Array.from({ length: positives }, () => ({ score, outcome: 1 })),
    ...Array.from({ length: negatives }, () => ({ score, outcome: 0 })),
  ];
}

test("recommendation is null below the overall outcome gate", () => {
  const pairs = bandPairs(40, 5, 5); // n=10 < 20
  assert.equal(recommendScreeningThreshold(pairs, 45), null);
});

test("recommendation is null when a threshold sits at the edges", () => {
  const pairs = bandPairs(40, 12, 12);
  assert.equal(recommendScreeningThreshold(pairs, 0), null);
  assert.equal(recommendScreeningThreshold(pairs, 100), null);
});

test("suggests LOWERING when candidates just below the floor mostly advanced", () => {
  // Floor 45; the [35,45) band advanced 9/10 (0.9 ≥ 0.6) with enough padding above.
  const pairs: ScoreOutcome[] = [
    ...bandPairs(40, 9, 1), // just below the floor — mostly advanced
    ...bandPairs(80, 10, 0), // padding so overall n ≥ 20
  ];
  const rec = recommendScreeningThreshold(pairs, 45);
  assert.ok(rec);
  assert.equal(rec!.direction, "lower");
  assert.equal(rec!.suggestedThreshold, 35);
  assert.deepEqual(rec!.band, { lo: 35, hi: 45 });
  assert.equal(rec!.n, 10);
  assert.equal(rec!.advanceRatePct, 90);
});

test("suggests RAISING when candidates just above the floor mostly did not advance", () => {
  // Floor 45; the [45,55) band advanced 1/10 (0.1 ≤ 0.4).
  const pairs: ScoreOutcome[] = [
    ...bandPairs(50, 1, 9), // just above the floor — mostly rejected
    ...bandPairs(90, 10, 0), // padding for the overall gate
  ];
  const rec = recommendScreeningThreshold(pairs, 45);
  assert.ok(rec);
  assert.equal(rec!.direction, "raise");
  assert.equal(rec!.suggestedThreshold, 55);
});

test("recommendation is null when the near-floor bands are too sparse to defend", () => {
  // Overall n ≥ 20, but only 3 candidates sit in the below-floor band (< MIN_BAND).
  const pairs: ScoreOutcome[] = [
    ...bandPairs(40, 3, 0), // below floor, but only 3 < 8
    ...bandPairs(80, 20, 0), // far from the floor — no adjacent signal
  ];
  assert.ok(MIN_CALIBRATION_BAND_OUTCOMES > 3);
  assert.equal(recommendScreeningThreshold(pairs, 45), null);
});

test("recommendation is null when adjacent bands are unremarkable (~50/50)", () => {
  const pairs: ScoreOutcome[] = [
    ...bandPairs(40, 5, 5), // below floor — 0.5, neither high nor low
    ...bandPairs(50, 5, 5), // above floor — 0.5
  ];
  assert.equal(recommendScreeningThreshold(pairs, 45), null);
});
