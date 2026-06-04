// Pins the archetype "advanced past screening" fairness metric (idea-43b946db):
// its math must agree with its label. "Past screening" means the candidate cleared
// the screening gate — reached Interview or beyond — so a candidate sitting AT
// Screened must NOT be counted. This guards the off-by-one the label once hid.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { PIPELINE_STAGES, hasAdvancedPastScreening } from "./pipeline-stages.ts";

test("the canonical stage order is Accepted→Screened→Interview→Offer→Hired", () => {
  assert.deepEqual([...PIPELINE_STAGES], ["Accepted", "Screened", "Interview", "Offer", "Hired"]);
});

test("a candidate AT Screened has NOT advanced past screening (the off-by-one)", () => {
  assert.equal(hasAdvancedPastScreening("Screened"), false);
});

test("stages before Interview are not past screening", () => {
  assert.equal(hasAdvancedPastScreening("Accepted"), false);
  assert.equal(hasAdvancedPastScreening("Screened"), false);
});

test("Interview and every later stage count as advanced past screening", () => {
  assert.equal(hasAdvancedPastScreening("Interview"), true);
  assert.equal(hasAdvancedPastScreening("Offer"), true);
  assert.equal(hasAdvancedPastScreening("Hired"), true);
});

test("an unknown stage is not counted as advanced", () => {
  assert.equal(hasAdvancedPastScreening("Sourced"), false);
  assert.equal(hasAdvancedPastScreening(""), false);
});
