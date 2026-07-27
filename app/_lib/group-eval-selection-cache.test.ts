// selection-rerun-cache — an eval launched with an EXPLICIT selection must be
// CACHED, keyed on the selected field's identity.
//
// The defect: the cache is keyed (role_key, workspace_id) — structurally one eval
// per role — so the modal bypassed it for every selection open. Reopening the
// byte-identical four-candidate comparison re-spawned the whole ≤8-process pipeline
// (LLM weight proposal, embeddings, per-candidate reasoning, compare narrative).
//
// The fix layers the selection's identity onto role_key: `roleKey#sel:<n>-<hash>`
// over the sorted member ids. What must hold:
//   • the identical selection resolves to the same key (a HIT) regardless of order;
//   • a different selection resolves to a different key (a MISS → a fresh run);
//   • a top-N run is untouched — still stored under the bare roleKey, and
//     listEvaluatedRoles must NOT start listing selection rows as separate roles.
//
// Drives the REAL runGroupEval + the real store against a throwaway DB —
// testing/unit-db.ts MUST be the FIRST project import. Run: npm run test:unit
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { groupEvalCacheKey, selectionCacheKey } from "@/app/features/sub_decisions/group-eval/cache-key";

// Force the best-effort AI "compare all" spawn to fail fast (ENOENT → deterministic
// fallback), so the test is hermetic. Set BEFORE python-runner is loaded.
process.env.PYTHON_CMD = "kp-no-python-for-this-test";
const { runGroupEval } = await import("./group-eval-run.ts");
const { getGroupEval, listEvaluatedRoles } = await import("./group-eval.ts");

after(() => cleanupUnitDb());

const cand = (entryId: string, matchScore: number) => ({ entryId, candidateId: null, label: entryId, matchScore });

test("the selection key is order-independent and set-specific", () => {
  const a = selectionCacheKey("role-x", ["e3", "e1", "e2"]);
  assert.equal(a, selectionCacheKey("role-x", ["e1", "e2", "e3"]), "click order must not change the identity of a comparison");
  assert.equal(a, selectionCacheKey("role-x", ["e1", "e2", "e3", "e3"]), "a duplicated id is the same field");
  assert.notEqual(a, selectionCacheKey("role-x", ["e1", "e2", "e4"]), "a different field is a different eval");
  assert.notEqual(a, selectionCacheKey("role-y", ["e1", "e2", "e3"]), "the role is part of the key");
  assert.ok(a.startsWith("role-x#sel:3-"), "the key layers onto the role key and carries the field size");
  // A top-N run keeps the bare role key — legacy rows and the evaluated chip are untouched.
  assert.equal(groupEvalCacheKey("role-x", null), "role-x");
  assert.equal(groupEvalCacheKey("role-x", []), "role-x");
  assert.equal(groupEvalCacheKey("role-x", ["e1", "e2"]), selectionCacheKey("role-x", ["e1", "e2"]));
});

test("a selection run is cached under its selection key; the identical selection HITS and a different one MISSES", async () => {
  const cohort = [cand("e1", 90), cand("e2", 80), cand("e3", 70), cand("e4", 60)];
  const selection = ["e2", "e3"];
  await runGroupEval({
    roleKey: "role-cache",
    roleTitle: "Backend Engineer",
    candidates: cohort.filter((c) => selection.includes(c.entryId)),
    cohort,
    governanceMode: "recommendation",
  });
  // HIT — what the modal computes for the same field (any order) is what was written.
  const hit = getGroupEval(selectionCacheKey("role-cache", ["e3", "e2"]));
  assert.ok(hit, "reopening the identical selection serves the cache instead of re-spawning");
  assert.deepEqual(new Set((hit!.payload as { comparedIds: string[] }).comparedIds), new Set(["e2", "e3"]));
  // MISS — a changed selection is a different comparison and must spawn.
  assert.equal(getGroupEval(selectionCacheKey("role-cache", ["e2", "e4"])), null, "a changed selection must not be served a stale eval");
  // The role's own top-N slot is untouched by the selection run.
  assert.equal(getGroupEval("role-cache"), null, "a selection run must not overwrite (or fabricate) the role-level top-N eval");
  // …and the selection row is invisible to the roles listing that drives the chip.
  assert.deepEqual(listEvaluatedRoles(["role-cache"]), {}, "selection rows must never be listed as evaluated roles");
});

test("a top-N run is byte-identical: stored under the bare role key and listed as evaluated", async () => {
  await runGroupEval({
    roleKey: "role-topn",
    roleTitle: "Backend Engineer",
    candidates: [cand("e1", 90), cand("e2", 80)],
    governanceMode: "recommendation",
  });
  const stored = getGroupEval("role-topn");
  assert.ok(stored, "the default run still lands on the role key");
  assert.equal(stored!.payload.selection, null, "…and is still a top-N run");
  assert.ok(listEvaluatedRoles(["role-topn"])["role-topn"], "the evaluated chip still lights up");
});

test("a selection AND a top-N eval for the same role coexist — neither evicts the other", async () => {
  const cohort = [cand("a1", 90), cand("a2", 80), cand("a3", 70)];
  await runGroupEval({ roleKey: "role-both", roleTitle: "Backend Engineer", candidates: cohort, governanceMode: "recommendation" });
  await runGroupEval({
    roleKey: "role-both",
    roleTitle: "Backend Engineer",
    candidates: [cohort[1], cohort[2]],
    cohort,
    governanceMode: "recommendation",
  });
  const topN = getGroupEval("role-both");
  const sel = getGroupEval(selectionCacheKey("role-both", ["a2", "a3"]));
  assert.equal((topN!.payload as { candidateCount: number }).candidateCount, 3, "the top-N eval still covers the whole field");
  assert.equal((sel!.payload as { candidateCount: number }).candidateCount, 2, "the selection eval covers the chosen field");
});

test("a selection that falls back to top-N is stored under the ROLE key (it IS a top-N run)", async () => {
  // Only one selected id still belongs to the cohort → below GROUP_EVAL_MIN_COHORT, so
  // runGroupEval degrades to the default top-N; the cache key must degrade with it.
  const cohort = [cand("b1", 90), cand("b2", 80), cand("b3", 70)];
  await runGroupEval({
    roleKey: "role-fallback",
    roleTitle: "Backend Engineer",
    candidates: [cand("b2", 80), cand("gone", 50)],
    cohort,
    governanceMode: "recommendation",
  });
  assert.ok(getGroupEval("role-fallback"), "the fallback run is a top-N run and caches like one");
  assert.equal(getGroupEval(selectionCacheKey("role-fallback", ["b2", "gone"])), null);
});

test("governance stickiness survives a selection-only role (the stored mode is still found)", async () => {
  const cohort = [cand("c1", 90), cand("c2", 80), cand("c3", 70)];
  const selection = [cohort[0], cohort[1]];
  await runGroupEval({ roleKey: "role-gov", roleTitle: "Backend Engineer", candidates: selection, cohort, governanceMode: "committee" });
  // A second run of the SAME selection with the client's reset "recommendation" must
  // not downgrade the role's governance (bug-ui-scan-2026-07-09 #1).
  const again = await runGroupEval({ roleKey: "role-gov", roleTitle: "Backend Engineer", candidates: selection, cohort, governanceMode: "recommendation" });
  assert.equal(again.governanceMode, "committee", "a governed selection run stays governed");
});

test("the modal's cached read is keyed on the SAME helper the server persists with", () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "features", "sub_decisions", "DecisionsTab.tsx"),
    "utf8"
  );
  // The old bug in one line: `hasSelection` unconditionally skipped the cached read.
  assert.doesNotMatch(src, /!rerun && !hasSelection/, "a selection open must no longer bypass the cache outright");
  assert.match(src, /selectionCacheKey\(g\.roleKey, candidates\.map\(\(c\) => c\.entryId\)\)/, "the client must derive the key from the same ids the server hashes");
  assert.match(src, /role=\$\{encodeURIComponent\(cacheKey\)\}/, "the cached read must go to the run's cache key, not always the role key");
});
