import { test } from "node:test";
import assert from "node:assert/strict";
import { columnStats, STRONG_THRESHOLD } from "./matrix-stats.ts";

// MAT2 — per-role column distribution stats for the Fit Matrix.

test("empty column reports zeros + null best/median (no NaN)", () => {
  const s = columnStats([]);
  assert.deepEqual(s, { count: 0, best: null, median: null, strong: 0, buckets: [0, 0, 0, 0, 0] });
});

test("best, median (odd count), and strong count", () => {
  const s = columnStats([40, 75, 90]);
  assert.equal(s.count, 3);
  assert.equal(s.best, 90);
  assert.equal(s.median, 75); // middle of sorted [40,75,90]
  assert.equal(s.strong, 2); // 75 and 90 are >= STRONG_THRESHOLD (72)
});

test("median averages the two middles on an even count", () => {
  assert.equal(columnStats([40, 60, 80, 100]).median, 70); // (60+80)/2
});

test("buckets land in the five legend bands", () => {
  // <45 | 45–59 | 60–71 | 72–84 | 85+
  const s = columnStats([10, 44, 45, 59, 60, 71, 72, 84, 85, 100]);
  assert.deepEqual(s.buckets, [2, 2, 2, 2, 2]);
});

test("band boundaries are inclusive-low (edge scores climb to the next band)", () => {
  assert.deepEqual(columnStats([45]).buckets, [0, 1, 0, 0, 0]);
  assert.deepEqual(columnStats([72]).buckets, [0, 0, 0, 1, 0]);
  assert.deepEqual(columnStats([85]).buckets, [0, 0, 0, 0, 1]);
  assert.equal(columnStats([STRONG_THRESHOLD]).strong, 1);
  assert.equal(columnStats([STRONG_THRESHOLD - 1]).strong, 0);
});
