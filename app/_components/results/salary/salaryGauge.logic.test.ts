// bug-ui-scan-2026-07-09 (analysis-result-panels #4): the growth marker's caption
// must reflect the ACTUAL (rounded) target, not a fixed "+30%".
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confidenceOpacity,
  growthMarkerPercent,
  growthRoundingStep,
  roundGrowthTarget,
} from "./salaryGauge.logic.ts";

test("the rounded target's real delta is reported, not a fixed 30", () => {
  // SalaryTab rounds: round(41000 * 1.3 / 5000) * 5000 === 55000 → +34%, not +30%.
  assert.equal(growthMarkerPercent(41000, 55000), 34);
});

test("an unrounded +30% target reads 30", () => {
  assert.equal(growthMarkerPercent(50000, 65000), 30);
});

test("undefined-delta inputs return null (UI falls back to a 'Target' label)", () => {
  assert.equal(growthMarkerPercent(0, 0), null);
  assert.equal(growthMarkerPercent(-1, 100), null);
  assert.equal(growthMarkerPercent(NaN, 100), null);
  assert.equal(growthMarkerPercent(50000, Infinity), null);
});

// Direction 1 (#c): the rounding step scales with the figure's magnitude, and the
// whole typical CZK band (10 000–99 999) is byte-identical to the old /5000 step.
test("the rounding step is half the leading power of ten of the anchor", () => {
  assert.equal(growthRoundingStep(41000), 5000); // 10^4 / 2 — CZK band
  assert.equal(growthRoundingStep(99999), 5000);
  assert.equal(growthRoundingStep(2500), 500); // 10^3 / 2 — EUR band
  assert.equal(growthRoundingStep(250000), 50000); // 10^5 / 2
});

test("a non-positive or non-finite anchor yields a no-op step of 1", () => {
  assert.equal(growthRoundingStep(0), 1);
  assert.equal(growthRoundingStep(-100), 1);
  assert.equal(growthRoundingStep(NaN), 1);
});

test("CZK growth targets round exactly as the old fixed 5000 step did", () => {
  // Old: round(41000 * 1.3 / 5000) * 5000 === 55000.
  assert.equal(roundGrowthTarget(41000), 55000);
  assert.equal(roundGrowthTarget(50000), 65000);
});

test("EUR-scale growth targets round to a currency-appropriate step, not 5000", () => {
  // 2500 * 1.3 = 3250, step 500 -> 3500 (the old 5000 step would have snapped to
  // 5000, larger than the whole salary).
  assert.equal(roundGrowthTarget(2500), 3500);
});

test("a non-positive midpoint gives a zero target (UI falls back to a plain label)", () => {
  assert.equal(roundGrowthTarget(0), 0);
  assert.equal(roundGrowthTarget(NaN), 0);
});

// Direction 1 (#e): unknown confidence must NOT render at full opacity like "high".
test("known confidence bands map to their emphasis and are flagged known", () => {
  assert.deepEqual(confidenceOpacity("low"), { opacity: 0.6, known: true });
  assert.deepEqual(confidenceOpacity("MEDIUM"), { opacity: 0.8, known: true });
  assert.deepEqual(confidenceOpacity("high"), { opacity: 1, known: true });
});

test("unknown/absent confidence renders at the lowest emphasis, flagged not-known", () => {
  for (const value of ["", "  ", "bogus", null, undefined]) {
    const result = confidenceOpacity(value);
    assert.equal(result.known, false);
    assert.equal(result.opacity, 0.4);
    assert.ok(result.opacity < 0.6, "unknown must be fainter than 'low'");
  }
});
