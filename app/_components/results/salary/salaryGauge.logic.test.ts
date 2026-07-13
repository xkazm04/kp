// bug-ui-scan-2026-07-09 (analysis-result-panels #4): the growth marker's caption
// must reflect the ACTUAL (rounded) target, not a fixed "+30%".
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { growthMarkerPercent } from "./salaryGauge.logic.ts";

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
