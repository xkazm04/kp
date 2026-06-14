import { test } from "node:test";
import assert from "node:assert/strict";
import { rubricCompare } from "./devcase-compare.ts";

const rubric = [
  { name: "framing", label: "Problem framing" },
  { name: "judgment", label: "Judgment" },
];

const sub = (id: string, transferScore: number | null, scores: Record<string, number>) => ({
  id,
  candidateRef: `cand-${id}`,
  transferScore,
  evaluation: { evaluation: { dimensionScores: scores } },
});

test("lays evaluated submissions out as an axis × candidate matrix", () => {
  const cmp = rubricCompare(rubric, [
    sub("a", 80, { framing: 70, judgment: 90 }),
    sub("b", 60, { framing: 85, judgment: 55 }),
  ]);
  assert.deepEqual(cmp.axes.map((a) => a.name), ["framing", "judgment"]);
  // ordered by transferScore desc
  assert.deepEqual(cmp.columns.map((c) => c.id), ["a", "b"]);
  assert.equal(cmp.columns[0].scores.judgment, 90);
});

test("marks the leader per axis", () => {
  const cmp = rubricCompare(rubric, [
    sub("a", 80, { framing: 70, judgment: 90 }),
    sub("b", 60, { framing: 85, judgment: 55 }),
  ]);
  assert.equal(cmp.leaderByAxis.framing, "b"); // 85 > 70
  assert.equal(cmp.leaderByAxis.judgment, "a"); // 90 > 55
});

test("prefers the ordered `dimensions` projection over dimensionScores", () => {
  const cmp = rubricCompare(rubric, [
    {
      id: "a",
      candidateRef: "cand-a",
      transferScore: 50,
      evaluation: { evaluation: { dimensions: [{ name: "framing", score: 42 }], dimensionScores: { framing: 99 } } },
    },
  ]);
  assert.equal(cmp.columns[0].scores.framing, 42);
});

test("unscored axes are null, and a never-scored axis has a null leader", () => {
  const cmp = rubricCompare(rubric, [sub("a", 50, { framing: 70 })]);
  assert.equal(cmp.columns[0].scores.judgment, null);
  assert.equal(cmp.leaderByAxis.judgment, null);
  assert.equal(cmp.leaderByAxis.framing, "a");
});

test("derives axes from the submissions when the case carries no rubric", () => {
  const cmp = rubricCompare([], [sub("a", 50, { framing: 70, tooling: 80 })]);
  assert.deepEqual(cmp.axes.map((a) => a.name).sort(), ["framing", "tooling"]);
});

test("caps the matrix width to the top-N by transfer score", () => {
  const subs = [sub("a", 30, { framing: 1 }), sub("b", 90, { framing: 1 }), sub("c", 60, { framing: 1 })];
  const cmp = rubricCompare(rubric, subs, 2);
  assert.deepEqual(cmp.columns.map((c) => c.id), ["b", "c"]); // top 2 by transfer
});

test("unevaluated submissions are excluded", () => {
  const cmp = rubricCompare(rubric, [sub("a", 50, { framing: 70 }), { id: "b", candidateRef: "cand-b", transferScore: null, evaluation: null }]);
  assert.deepEqual(cmp.columns.map((c) => c.id), ["a"]);
});
