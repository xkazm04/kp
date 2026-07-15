// selection-memory-rerun (end-to-end) — the persisted eval payload must carry stable
// entry ids (evaluatedIds = the full cohort; comparedIds = the field actually compared)
// so a selection-launched eval's Re-run can replay the SELECTION and drift can key on
// identity. And a replayed selection that has shrunk below the comparable floor
// (GROUP_EVAL_MIN_COHORT) must fall back to the default top-N over the full cohort — an
// honest, useful result — rather than an "insufficient sample" single-candidate selection.
//
// Drives the REAL runGroupEval against a throwaway DB — testing/unit-db.ts MUST be the
// FIRST project import. Run: npm run test:unit
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

// Force the best-effort AI "compare all" spawn to fail fast (ENOENT → deterministic
// fallback), so the test is hermetic. Set BEFORE python-runner is loaded.
process.env.PYTHON_CMD = "kp-no-python-for-this-test";
const { runGroupEval } = await import("./group-eval-run.ts");

after(() => cleanupUnitDb());

const cand = (entryId: string, matchScore: number) => ({ entryId, candidateId: null, label: entryId, matchScore });

test("a valid selection persists comparedIds (the chosen field) + evaluatedIds (the full cohort)", async () => {
  const cohort = [cand("e1", 90), cand("e2", 80), cand("e3", 70), cand("e4", 60)];
  const selection = [cand("e2", 80), cand("e3", 70)];
  const res = await runGroupEval({
    roleKey: "role-sel",
    roleTitle: "Backend Engineer",
    candidates: selection,
    cohort,
    governanceMode: "recommendation",
  });
  // Coverage discloses the selection honestly: 2 compared of the 4-candidate cohort.
  assert.deepEqual(res.selection, { count: 2, total: 4 }, "a validated selection discloses count-of-total");
  // comparedIds is the selection (order is fit-sorted; assert as a set).
  assert.deepEqual(new Set(res.comparedIds as string[]), new Set(["e2", "e3"]), "comparedIds = the compared selection");
  // evaluatedIds mirrors the FULL cohort (parallel to evaluatedLabels), for id-based drift.
  assert.deepEqual(new Set(res.evaluatedIds as string[]), new Set(["e1", "e2", "e3", "e4"]), "evaluatedIds = the full cohort");
});

test("a replayed selection with <2 survivors falls back to top-N over the full cohort", async () => {
  // The saved selection was [e2, gone-a, gone-b]; only e2 still belongs to the cohort.
  const cohort = [cand("e1", 90), cand("e2", 80), cand("e3", 70)];
  const stale = [cand("e2", 80), cand("gone-a", 50), cand("gone-b", 40)];
  const res = await runGroupEval({
    roleKey: "role-drift",
    roleTitle: "Backend Engineer",
    candidates: stale,
    cohort,
    governanceMode: "recommendation",
  });
  // Only 1 selected id survived (< GROUP_EVAL_MIN_COHORT) → NOT an insufficient-sample
  // selection of one, but the default top-N over the whole cohort.
  assert.equal(res.selection, null, "a sub-pair survivor set does not run as a selection");
  assert.deepEqual(new Set(res.comparedIds as string[]), new Set(["e1", "e2", "e3"]), "the full cohort is compared as top-N");
  assert.notEqual(res.robustness, "insufficient_sample", "a real 3-candidate field is comparable");
});

test("legacy shape (no cohort/selection) is byte-identical — comparedIds = the top-N field", async () => {
  const res = await runGroupEval({
    roleKey: "role-topn",
    roleTitle: "Backend Engineer",
    candidates: [cand("t1", 90), cand("t2", 60)],
    governanceMode: "recommendation",
  });
  assert.equal(res.selection, null, "no explicit selection ⇒ no selection disclosure");
  assert.deepEqual(new Set(res.comparedIds as string[]), new Set(["t1", "t2"]));
  assert.deepEqual(new Set(res.evaluatedIds as string[]), new Set(["t1", "t2"]));
});
