import { test } from "node:test";
import assert from "node:assert/strict";
import { bestVisibleScore, orderMatrixRows } from "./matrixRows.ts";

// bug-ui-scan-2026-07-09 (skill-matrix-coverage #4). Each test below FAILS against the
// pre-fix inline logic `Math.max(0, ...visible.map((s) => s ?? -1))`, which collapsed an
// all-null row to 0, conflating "not assessed" with a genuine score of 0.

test("bestVisibleScore returns null for a row with NO assessed cell (not 0)", () => {
  // Pre-fix produced Math.max(0, -1, -1) === 0 here — the whole bug.
  assert.equal(bestVisibleScore([null, undefined, null]), null);
  assert.equal(bestVisibleScore([]), null);
});

test("bestVisibleScore keeps a genuine 0 distinct from unassessed, and takes the max", () => {
  assert.equal(bestVisibleScore([0, null]), 0); // a real 0 is a number, not null
  assert.equal(bestVisibleScore([null, 40, null, 62]), 62);
  assert.equal(bestVisibleScore([NaN, 30]), 30); // non-finite ignored
});

test("unassessed (null-best) rows sort into a TRAILING group, below a genuine 0", () => {
  const rows = [
    { item: "unassessed", label: "Zed", visibleScores: [null, null] },
    { item: "zero", label: "Amy", visibleScores: [0, null] },
    { item: "strong", label: "Bo", visibleScores: [80, 50] },
  ];
  const { order } = orderMatrixRows(rows, { sortByFit: true, sortByColumn: false, minFit: 0 });
  // strong (80) > zero (0) > unassessed (null trails). Pre-fix the unassessed row scored 0
  // and tied/ordered ambiguously with the genuine-0 row.
  assert.deepEqual(order, ["strong", "zero", "unassessed"]);
});

test("the min-fit floor hides an unassessed row as 'unassessed', NOT as a below-floor weak fit", () => {
  const rows = [
    { item: "strong", label: "A", visibleScores: [75] },
    { item: "weak", label: "B", visibleScores: [30] },
    { item: "blocked", label: "C", visibleScores: [null] },
  ];
  const res = orderMatrixRows(rows, { sortByFit: true, sortByColumn: false, minFit: 55 });
  assert.deepEqual(res.order, ["strong"]);
  assert.equal(res.hiddenByFloor, 1); // "weak" scored 30 < 55
  assert.equal(res.hiddenUnassessed, 1); // "blocked" had no assessed cell — counted apart
});

test("floor OFF keeps every row, unassessed still trailing", () => {
  const rows = [
    { item: "blocked", label: "A", visibleScores: [null] },
    { item: "mid", label: "B", visibleScores: [50] },
  ];
  const res = orderMatrixRows(rows, { sortByFit: true, sortByColumn: false, minFit: 0 });
  assert.deepEqual(res.order, ["mid", "blocked"]);
  assert.equal(res.hiddenByFloor, 0);
  assert.equal(res.hiddenUnassessed, 0);
});

test("column sort ranks by the chosen column, sinking rows unassessed on THAT column", () => {
  const rows = [
    { item: "hi", label: "A", visibleScores: [90, 10], sortColScore: 10 },
    { item: "lo", label: "B", visibleScores: [20, 88], sortColScore: 88 },
    { item: "none", label: "C", visibleScores: [70, null], sortColScore: null },
  ];
  const { order } = orderMatrixRows(rows, { sortByFit: true, sortByColumn: true, minFit: 0 });
  assert.deepEqual(order, ["lo", "hi", "none"]);
});

test("A–Z sort is alphabetical regardless of assessment", () => {
  const rows = [
    { item: "z", label: "Zoe", visibleScores: [99] },
    { item: "a", label: "Ada", visibleScores: [null] },
  ];
  const { order } = orderMatrixRows(rows, { sortByFit: false, sortByColumn: false, minFit: 0 });
  assert.deepEqual(order, ["a", "z"]);
});
