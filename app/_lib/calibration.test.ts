import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCalibration,
  MIN_CALIBRATION_OUTCOMES,
  CALIBRATION_BIN_COUNT,
  type ScoreOutcome,
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
