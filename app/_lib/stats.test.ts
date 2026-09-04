// The shared median's POLICY, pinned. Four surfaces now inherit it (source
// analytics' decision-time hours, the pipeline's time-to-hire, the model matrix'
// p50 latency, the insights matrix' column median), so each clause below is a
// claim four readouts make at once.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   node scripts/run-unit-tests.mjs app/_lib/stats.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { median } from "./stats.ts";

test("median: an empty sample is null, never 0", () => {
  // 0 is a measurement; "nothing was measured" is not. llm-quality's local median
  // answered 0 here, and the overview would have printed a 0 ms p50.
  assert.equal(median([]), null);
});

test("median: odd counts take the middle observation", () => {
  assert.equal(median([10, 1, 5]), 5);
  assert.equal(median([7]), 7);
});

test("median: even counts take the MEAN of the two middles, not the upper one", () => {
  // NON-VACUITY: llm-quality's `sorted[Math.floor(n/2)]` answered 20 for [10, 20]
  // and 30 for [10, 20, 30, 40] — both of these assertions fail against it.
  assert.equal(median([10, 20]), 15);
  assert.equal(median([40, 10, 30, 20]), 25);
});

test("median: the tie policy is symmetric — reversing the sample cannot move it", () => {
  const sample = [3, 1, 4, 1, 5, 9, 2, 6];
  assert.equal(median(sample), median([...sample].reverse()));
});

test("median: non-finite samples are dropped, not sorted into the middle", () => {
  // NON-VACUITY: with NaN kept, Array.prototype.sort leaves it wherever the
  // comparator's 0-ish answer put it and it can BECOME the median — assert.equal
  // against NaN fails. Infinity kept would drag the even-count mean to Infinity.
  assert.equal(median([1, NaN, 3]), 2);
  assert.equal(median([1, Number.POSITIVE_INFINITY, 3, Number.NEGATIVE_INFINITY]), 2);
  assert.equal(median([NaN, NaN]), null, "a wholly invalid sample is empty, so null");
});

test("median: the result is exact — no rounding, no clamping", () => {
  // Presentation precision is the caller's (0.1h / whole days / floor on the
  // matrix); a median that pre-rounded would silently double-round downstream.
  assert.equal(median([1, 2]), 1.5);
  assert.equal(median([-4, -2]), -3, "negatives are legitimate observations here");
});

test("median: the caller's sample is not mutated", () => {
  const sample = [3, 1, 2];
  median(sample);
  assert.deepEqual(sample, [3, 1, 2]);
});
