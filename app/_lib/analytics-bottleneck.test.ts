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

test("a tie is broken by stage name, not by the order the stages arrived in", () => {
  // Two stages, identical average wait and identical sample. The winner used to be
  // whichever key `Object.entries` yielded first — insertion order, which is the
  // order the DB's GROUP BY happened to return. The amber banner names ONE stage and
  // sends the recruiter there, so which of two equal stages it names must not depend
  // on a query's row order: the same board rendered twice could accuse a different
  // stage each time, and nothing on screen would say the two were tied.
  const days = [40, 40, 40];
  const zetaFirst = pickBottleneck({ Zeta: days, Alpha: days });
  const alphaFirst = pickBottleneck({ Alpha: days, Zeta: days });
  assert.equal(zetaFirst?.stage, "Alpha", "the tie resolves to the first stage by name");
  assert.deepEqual(zetaFirst, alphaFirst, "input order cannot change the verdict");
});

test("a tie in the ROUNDED average still follows the real average", () => {
  // avgDaysInStage is rounded for display; the pick is made on the raw mean, so a
  // stage that is genuinely slower keeps the banner even when both round to 40.
  const a = pickBottleneck({ Alpha: [39.6, 39.6, 39.6], Beta: [40.4, 40.4, 40.4] });
  assert.equal(a?.stage, "Beta", "the larger raw average wins before the name rule applies");
  assert.equal(a?.avgDaysInStage, 40);
});
