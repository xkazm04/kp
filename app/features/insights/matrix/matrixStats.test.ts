import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { columnStats, STRONG_THRESHOLD, MIN_FIT_FLOORS, MATRIX_BANDS, uncoveredRoles } from "./matrixStats.ts";
import { FIT_PROMISING_FLOOR, FIT_STRONG_FLOOR } from "../../../_lib/fit-thresholds.ts";

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
  assert.equal(s.strong, 2); // 75 and 90 are >= STRONG_THRESHOLD
});

test("median averages the two middles on an even count", () => {
  assert.equal(columnStats([40, 60, 80, 100]).median, 70); // (60+80)/2
});

test("buckets land in the five legend bands", () => {
  // Two scores per band: each band's floor and one below the next band's floor.
  const scores: number[] = [];
  for (let i = 0; i < MATRIX_BANDS.length; i++) {
    const next = MATRIX_BANDS[i + 1]?.min ?? 101;
    scores.push(MATRIX_BANDS[i].min, next - 1);
  }
  assert.deepEqual(columnStats(scores).buckets, [2, 2, 2, 2, 2]);
});

test("band boundaries are inclusive-low (edge scores climb to the next band)", () => {
  for (let i = 1; i < MATRIX_BANDS.length; i++) {
    const want: number[] = [0, 0, 0, 0, 0];
    want[i] = 1;
    assert.deepEqual(columnStats([MATRIX_BANDS[i].min]).buckets, want, `${MATRIX_BANDS[i].min} opens band ${i}`);
  }
  assert.equal(columnStats([STRONG_THRESHOLD]).strong, 1);
  assert.equal(columnStats([STRONG_THRESHOLD - 1]).strong, 0);
});

// challenge 2026-09-22 matrix-grid/A — the grid is on the app's one tier scale.

test("the strong line and the min-fit floors ARE the shared fit floors", () => {
  assert.equal(STRONG_THRESHOLD, FIT_STRONG_FLOOR);
  assert.deepEqual([...MIN_FIT_FLOORS], [0, FIT_PROMISING_FLOOR, FIT_STRONG_FLOOR]);
});

test("every tier boundary opens a band, so no band straddles a tier edge", () => {
  const floors = MATRIX_BANDS.map((b) => b.min as number);
  assert.ok(floors.includes(FIT_PROMISING_FLOOR), "promising floor is a band floor");
  assert.ok(floors.includes(FIT_STRONG_FLOOR), "strong floor is a band floor");
  // Every offered min-fit floor lands on a band edge (the skill-matrix-coverage #3 guarantee).
  for (const f of MIN_FIT_FLOORS) assert.ok(floors.includes(f), `floor ${f} is a band edge`);
  // Ordered, strictly increasing.
  for (let i = 1; i < floors.length; i++) assert.ok(floors[i] > floors[i - 1]);
});

test("matrixStats.ts derives the tier edges instead of re-typing them", () => {
  const src = readFileSync(fileURLToPath(new URL("./matrixStats.ts", import.meta.url)), "utf8");
  // Strip comments so the prose may still NAME the old numbers.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // A `/` or `-` before the digits is a Tailwind class (`bg-moss/70`), not a number.
  for (const n of [55, 70, 72]) {
    assert.doesNotMatch(code, new RegExp(`(?<![\\w./-])${n}(?![\\w.])`), `no numeric literal ${n} in matrixStats.ts code`);
  }
});

test("a column of 69/70/71 has two strong fits, like the focus-mode badge says", () => {
  assert.equal(columnStats([69, 70, 71]).strong, 2);
});

test("uncoveredRoles reports a role only when its best non-blocked score is below strong", () => {
  const cols = [
    { p: { title: "Covered at 71" }, i: 0 },
    { p: { title: "Best is 69" }, i: 1 },
    { p: { title: "All blocked" }, i: 2 },
  ];
  const colScores: Record<number, number[]> = { 0: [40, 71], 1: [69, 12], 2: [] };
  assert.deepEqual(uncoveredRoles(cols, colScores), ["Best is 69", "All blocked"]);
});

test("uncoveredRoles treats a column missing from colScores as uncovered", () => {
  assert.deepEqual(uncoveredRoles([{ p: { title: "R" }, i: 7 }], {}), ["R"]);
});
