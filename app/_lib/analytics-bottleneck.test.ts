// Pins the small-sample bottleneck guard (idea-bdaf9b2c): a single stale entry
// in an otherwise-empty stage must NOT be surfaced as a systemic bottleneck, and
// when a stage does qualify the reported sample size must match the inputs.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { pickBottleneck, BOTTLENECK_MIN_SAMPLE } from "./analytics-bottleneck.ts";

test("a single stale entry (n=1) never masquerades as a bottleneck", () => {
  // Screened has one entry that has waited 99 days; nothing should be reported.
  assert.equal(pickBottleneck({ Screened: [99] }), null);
});

test("nothing qualifies until a stage reaches the minimum sample", () => {
  const days = Array.from({ length: BOTTLENECK_MIN_SAMPLE - 1 }, () => 50);
  assert.equal(pickBottleneck({ Interview: days }), null);
});

test("the smallest qualifying stage is picked once it clears the bar", () => {
  const days = Array.from({ length: BOTTLENECK_MIN_SAMPLE }, () => 10);
  assert.deepEqual(pickBottleneck({ Screened: days }), {
    stage: "Screened",
    avgDaysInStage: 10,
    entryCount: BOTTLENECK_MIN_SAMPLE,
  });
});

test("among qualifying stages the highest average wins; tiny stages are ignored", () => {
  const result = pickBottleneck({
    Sourced: [40, 40, 40], // qualifies, avg 40
    Screened: [100], // higher avg but n=1 — ignored
    Interview: [10, 20, 30, 40], // qualifies, avg 25
  });
  assert.deepEqual(result, { stage: "Sourced", avgDaysInStage: 40, entryCount: 3 });
});

test("the average is rounded and the entry count is exact", () => {
  const result = pickBottleneck({ Offer: [10, 11, 12, 14] }); // avg 11.75 -> 12
  assert.deepEqual(result, { stage: "Offer", avgDaysInStage: 12, entryCount: 4 });
});

test("an empty map yields no bottleneck", () => {
  assert.equal(pickBottleneck({}), null);
});

test("a custom minSample threshold is honored", () => {
  assert.equal(pickBottleneck({ A: [5, 5] }, 5), null);
  assert.deepEqual(pickBottleneck({ A: [5, 5] }, 2), { stage: "A", avgDaysInStage: 5, entryCount: 2 });
});
