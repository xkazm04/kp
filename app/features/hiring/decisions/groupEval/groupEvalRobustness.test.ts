import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assessRobustness } from "@/app/features/shared/groupEvalTypes";
import type { Fairness } from "@/app/features/shared/groupEvalTypes";
import { robustOrderEntries, robustOrderVerdict } from "./groupEvalHelpers.ts";

// bug-ui-scan-2026-07-09 (group-evaluation-fairness #2): the weighting-robustness
// "gate" could not fail — it asserted "robust" from a NO-OP (uniform weights) and
// vanished silently on ranker failure, while the lead was sealed either way. These
// tests pin the honest states.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");

const uniform: Fairness = {
  labels: ["Ada", "Bo"],
  candidateIds: ["c1", "c2"],
  schemes: [
    { skills: 0.5, career: 0.3, personal: 0.2 },
    { skills: 0.5, career: 0.3, personal: 0.2 },
  ],
  matrix: [
    [70, 70],
    [65, 65],
  ],
  own: [70, 65],
  mean: [70, 65],
  ranking: ["Ada", "Bo"],
  weightNotes: {}, // no candidate carried an evidence-driven weight adjustment
  weightSource: "deterministic",
};

const varied: Fairness = {
  ...uniform,
  schemes: [uniform.schemes[0], { skills: 0.6, career: 0.25, personal: 0.15 }],
  matrix: [[70, 72], [63, 65]],
  own: [70, 65],
  mean: [71, 64],
};

test("uniform weights are reported as NOT tested — never 'assessed' (a no-op cannot pass)", () => {
  assert.equal(assessRobustness(true, uniform), "not_varied");
  assert.notEqual(assessRobustness(true, uniform), "assessed");
});

test("a ranker failure (job-backed role, no fairness matrix) surfaces as could-not-assess", () => {
  assert.equal(assessRobustness(true, null), "unavailable");
});

test("a job-less role is not-applicable — the panel stays hidden, no false robustness claim", () => {
  assert.equal(assessRobustness(false, null), "not_applicable");
});

test("varied, ranker-produced weights are a genuine assessment", () => {
  assert.equal(assessRobustness(true, varied), "assessed");
});

test("notes alone cannot claim a weighting check, and unequal schemes need no notes", () => {
  assert.equal(
    assessRobustness(true, { ...uniform, weightNotes: { c1: ["evidence changed"] } }),
    "not_varied",
  );
  assert.equal(assessRobustness(true, { ...varied, weightNotes: {} }), "assessed");
});

test("a single-candidate field is insufficient_sample, never assessed", () => {
  const oneRow: Fairness = {
    labels: ["Ada"],
    candidateIds: ["c1"],
    schemes: [{ skills: 0.5, career: 0.3, personal: 0.2 }],
    matrix: [[70]],
    own: [70],
    mean: [70],
    ranking: ["Ada"],
    weightNotes: { c1: ["skills weighted up on high-trust evidence"] },
    weightSource: "deterministic",
  };
  assert.equal(assessRobustness(true, oneRow), "insufficient_sample");
  assert.notEqual(assessRobustness(true, oneRow), "assessed");
});

// ---- The robust-order vs headline-order claim ------------------------------
//
// The panel's closing line is a claim about the ORDER ("Agrees with the headline fit
// order above." / "…differs — weigh the matrix"). It used to be
//   ranking.length === headlineOrder.length && ranking.some((l, i) => l !== headlineOrder[i])
// which is FALSE — i.e. renders "agrees" — whenever the two lists merely have different
// lengths. The fairness matrix is built from the ranker's pool, which drops any compared
// candidate the ranker returned no row for, so a shorter `ranking` is an ordinary
// outcome, not a corrupt payload.
const oldDiverges = (ranking: string[], headline: string[]) =>
  ranking.length === headline.length && ranking.some((l, i) => l !== headline[i]);

test("a matrix over a SUBSET of the field is compared on its own field — not reported as agreeing", () => {
  // Cyril was compared (he is a column, and he is in the headline order) but the ranker
  // produced no row for him, so the matrix ranks only Ada and Bo — and it FLIPS them.
  const ranking = ["Bo", "Ada"];
  const headlineOrder = ["Ada", "Bo", "Cyril"];
  assert.equal(oldDiverges(ranking, headlineOrder), false, "the regression: a real flip read as 'agrees'");
  assert.equal(robustOrderVerdict(ranking, headlineOrder), "diverges");
});

test("a subset matrix that keeps the headline's relative order still agrees", () => {
  assert.equal(robustOrderVerdict(["Ada", "Bo"], ["Ada", "Bo", "Cyril"]), "agrees");
});

test("full-field agreement and divergence are unchanged", () => {
  assert.equal(robustOrderVerdict(["Ada", "Bo"], ["Ada", "Bo"]), "agrees");
  assert.equal(robustOrderVerdict(["Bo", "Ada"], ["Ada", "Bo"]), "diverges");
});

test("an unanswerable comparison claims NOTHING — never a default 'agrees'", () => {
  // A legacy payload with no recommendedOrder (the modal passes []) …
  assert.equal(oldDiverges(["Ada", "Bo"], []), false, "the regression: 'agrees' with an order that isn't there");
  assert.equal(robustOrderVerdict(["Ada", "Bo"], []), null);
  // … and a headline that doesn't name every ranked candidate.
  assert.equal(robustOrderVerdict(["Ada", "Bo"], ["Ada", "Cyril"]), null);
  assert.equal(robustOrderVerdict([], ["Ada", "Bo"]), null);
});

test("the uniform-weights panel copy no longer AFFIRMS the ranking is robust", () => {
  const en = JSON.parse(readFileSync(path.join(REPO_ROOT, "messages", "en.json"), "utf-8")) as {
    decisions: { groupEval: { fairnessUniform: string } };
  };
  const copy = en.decisions.groupEval.fairnessUniform;
  assert.ok(!/robust/i.test(copy), `fairnessUniform must not affirm "robust" for a no-op; got: ${copy}`);
  assert.ok(/not tested|no-op|does not establish/i.test(copy), `fairnessUniform should state it was not tested; got: ${copy}`);
});

// ---- The order verdict compares IDENTITY when both sides carry ids ----------
// (challenge-r06 tests-scoring-fairness/B) Two candidates named 'Jan Novák' in the
// opposite order read as "agrees" on labels — a swapped namesake order was invisible.
test("a swapped namesake order diverges when ids are present", () => {
  const labels = ["Jan Novák", "Jan Novák"];
  assert.equal(robustOrderVerdict(labels, labels), "agrees", "the label-only fallback cannot see the swap");
  assert.equal(robustOrderVerdict(labels, labels, { rankingIds: ["b", "a"], headlineIds: ["a", "b"] }), "diverges");
  assert.equal(robustOrderVerdict(labels, labels, { rankingIds: ["a", "b"], headlineIds: ["a", "b"] }), "agrees");
});

test("the id verdict projects the headline onto the matrix field like the label one", () => {
  assert.equal(robustOrderVerdict(["X", "Y"], [], { rankingIds: ["b", "a"], headlineIds: ["a", "c", "b"] }), "diverges");
  assert.equal(robustOrderVerdict(["X", "Y"], [], { rankingIds: ["a", "b"], headlineIds: ["a", "c", "b"] }), "agrees");
  assert.equal(robustOrderVerdict(["X", "Y"], [], { rankingIds: ["a", "b"], headlineIds: ["a", "c"] }), null);
});

test("a legacy payload without ids on either side falls back to the label comparison", () => {
  assert.equal(robustOrderVerdict(["Bo", "Ada"], ["Ada", "Bo"], { rankingIds: ["b", "a"] }), "diverges");
  assert.equal(robustOrderVerdict(["Ada", "Bo"], ["Ada", "Bo"], { headlineIds: ["b", "a"] }), "agrees");
});

test("robustOrderEntries resolves labels by id (namesakes stay distinct) and falls back for legacy blobs", () => {
  const entries = robustOrderEntries({ labels: ["Jan Novák", "Jan Novák", "Ada"], candidateIds: ["a", "b", "c"], ranking: ["Jan Novák", "Jan Novák"], rankingIds: ["b", "a"] });
  assert.deepEqual(entries, [
    { key: "b", label: "Jan Novák" },
    { key: "a", label: "Jan Novák" },
  ]);
  assert.deepEqual(robustOrderEntries({ labels: ["Ada", "Bo"], candidateIds: ["a", "b"], ranking: ["Bo", "Ada"] }), [
    { key: "rank-0", label: "Bo" },
    { key: "rank-1", label: "Ada" },
  ]);
});
