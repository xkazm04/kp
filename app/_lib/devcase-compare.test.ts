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

test("maxColumns 0 (no cap) expands a truncated 9-column fixture to the full evaluated set", () => {
  const subs = Array.from({ length: 9 }, (_, i) => sub(String(i), 90 - i, { framing: 1 }));
  assert.equal(rubricCompare(rubric, subs, 5).columns.length, 5);
  assert.equal(rubricCompare(rubric, subs, 0).columns.length, 9);
});

test("unevaluated submissions are excluded", () => {
  const cmp = rubricCompare(rubric, [sub("a", 50, { framing: 70 }), { id: "b", candidateRef: "cand-b", transferScore: null, evaluation: null }]);
  assert.deepEqual(cmp.columns.map((c) => c.id), ["a"]);
});

test("a suspect bundle exposes authenticityBand even when it leads an axis", () => {
  const cmp = rubricCompare(rubric, [
    {
      id: "gamer",
      candidateRef: "gamer",
      transferScore: 90,
      evaluation: {
        evaluation: { dimensionScores: { framing: 99, judgment: 40 } },
        authenticity: { band: "suspect", score: 12 },
      },
    },
    {
      id: "honest",
      candidateRef: "honest",
      transferScore: 70,
      evaluation: {
        evaluation: { dimensionScores: { framing: 60, judgment: 80 } },
        authenticity: { band: "authentic", score: 88 },
      },
    },
  ]);
  assert.equal(cmp.columns[0].id, "gamer");
  assert.equal(cmp.columns[0].authenticityBand, "suspect");
  assert.equal(cmp.columns[0].authenticityScore, 12);
  assert.equal(cmp.leaderByAxis.framing, "gamer");
  assert.equal(cmp.columns[1].authenticityBand, "authentic");
});

test("missing authenticity is null, never authentic", () => {
  const cmp = rubricCompare(rubric, [sub("a", 50, { framing: 70 })]);
  assert.equal(cmp.columns[0].authenticityBand, null);
  assert.equal(cmp.columns[0].authenticityScore, null);
});

// challenge-r10 devcase-detail/A: a keyless TEMPLATE transfer is a different instrument
// from a model-graded one. In a mixed cohort the matrix still shows the template column
// (the recruiter can read it) but marks it and never lets it lead an axis.
const withCurrency = (id: string, transferScore: number, transfer: string, scores: Record<string, number>) => ({
  id,
  candidateRef: `cand-${id}`,
  transferScore,
  evaluation: { evaluation: { dimensionScores: scores }, perStepSources: { transfer } },
});

test("a mixed cohort marks template columns and never lets them lead an axis", () => {
  const cmp = rubricCompare(rubric, [
    withCurrency("tpl", 85, "deterministic", { framing: 95, judgment: 99 }),
    withCurrency("llm", 72, "llm", { framing: 60 }),
  ]);
  const byId = Object.fromEntries(cmp.columns.map((c) => [c.id, c]));
  assert.equal(byId.tpl.currency, "template");
  assert.equal(byId.llm.currency, "graded");
  assert.equal(cmp.mixed, true);
  // Graded tier first, template listed after it.
  assert.deepEqual(cmp.columns.map((c) => c.id), ["llm", "tpl"]);
  assert.equal(cmp.leaderByAxis.framing, "llm", "95 on the template instrument does not beat a graded 60");
  assert.equal(cmp.leaderByAxis.judgment, null, "an axis only a template column scored has no leader");
});

test("a uniform keyless cohort compares as before: template columns lead among themselves", () => {
  const cmp = rubricCompare(rubric, [
    withCurrency("a", 60, "deterministic", { framing: 70 }),
    withCurrency("b", 80, "deterministic", { framing: 50 }),
  ]);
  assert.equal(cmp.mixed, false);
  assert.deepEqual(cmp.columns.map((c) => c.id), ["b", "a"]);
  assert.equal(cmp.leaderByAxis.framing, "a");
});
