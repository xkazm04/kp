// bug-ui-scan-2026-07-09 (analysis-result-panels #2): an absent confidence/
// completeness must render as "unknown" (null → chip omitted), NOT a definite "0%".
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatOptionalFraction } from "./archetypeBannerView.ts";

test("absent fraction returns null (pre-fix rendered a definite 0%)", () => {
  // Pre-fix: Math.round((undefined ?? 0) * 100) === 0 → "confidence 0%".
  assert.equal(formatOptionalFraction(undefined, "archetypeConfidence"), null);
  assert.equal(formatOptionalFraction(null, "completeness"), null);
});

test("non-finite fraction returns null rather than '0%'", () => {
  assert.equal(formatOptionalFraction(NaN, "archetypeConfidence"), null);
  assert.equal(formatOptionalFraction(Infinity, "archetypeConfidence"), null);
});

test("a genuine zero fraction still renders (0% is a real value, not absence)", () => {
  assert.equal(formatOptionalFraction(0, "archetypeConfidence"), "0%");
});

test("a present fraction renders a range-guarded percent", () => {
  assert.equal(formatOptionalFraction(0.73, "archetypeConfidence"), "73%");
  assert.equal(formatOptionalFraction(1, "completeness"), "100%");
  // Out-of-range (a 0..100 value fed as a fraction) clamps to 100%, not "8500%".
  assert.equal(formatOptionalFraction(85, "archetypeConfidence"), "100%");
});
