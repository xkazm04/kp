// Import the REAL native better-sqlite3 first (never a shim), so every store call
// below opens a genuine on-disk SQLite file.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file at
// module-eval time and must run BEFORE any module that transitively touches db-path.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { createLifecycle, getLifecycle, updateLifecycle } from "./devcase.ts";
import { rewriteLifecycleOutcomesForCase } from "./devcase-outcome-rewrite.ts";
import { withoutOutcomeWarning, type StageOutcome } from "../devcase-stage-outcome.ts";

// A successful Re-source must clear the "sourcing failed" warning it fixed.
//
// The lifecycle row offers Re-source (POST /api/devcase/source) on a `sourcing_failed`
// warning, but the route only seeded the pipeline and never touched
// dev_lifecycle.outcome_json - so after a SUCCESSFUL re-source the row kept claiming a
// crash that had been fixed, and kept offering the button. A status that lies. These
// pin the pure rule (drop one warning code, keep the rest), the store's rewrite (scoped
// to the case AND the team) and the route's wiring (clear on success, never on a throw).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WS = "ws-resource-a";
const OTHER = "ws-resource-b";

const failedOutcome = (): StageOutcome => ({
  code: "collecting_open",
  facts: { sourced: 0, skipped: 0 },
  warnings: [
    { code: "sourcing_failed", count: 1 },
    { code: "seed_skeleton_only", count: 1 },
    { code: "baseline_unavailable", count: 1 },
  ],
});

function lifecycleWith(caseId: string, outcome: StageOutcome | undefined, ws = WS): string {
  const lc = createLifecycle({ title: "Backend engineer" }, true, "en", ws);
  updateLifecycle(lc.id, { stage: "collecting", caseId, detail: "published; sourcing failed", ...(outcome ? { outcome } : {}) });
  return lc.id;
}

before(() => {
  getLifecycle("__init__");
});
after(() => cleanupUnitDb());

test("1. pure: withoutOutcomeWarning drops one code, keeps the others, and reports no-op as null", () => {
  const next = withoutOutcomeWarning(failedOutcome(), "sourcing_failed");
  assert.deepEqual(next, {
    code: "collecting_open",
    facts: { sourced: 0, skipped: 0 },
    warnings: [
      { code: "seed_skeleton_only", count: 1 },
      { code: "baseline_unavailable", count: 1 },
    ],
  });
  // Nothing to clear is a no-op the store can skip without writing.
  assert.equal(withoutOutcomeWarning(next!, "sourcing_failed"), null);
  assert.equal(withoutOutcomeWarning({ code: "halted", facts: {}, warnings: [] }, "sourcing_failed"), null);
});

test("2. store: a successful re-source clears sourcing_failed on the case's lifecycle and keeps the rest", () => {
  const id = lifecycleWith("case-ok", failedOutcome());
  const before = getLifecycle(id)!;
  const changed = rewriteLifecycleOutcomesForCase("case-ok", WS, (o) => withoutOutcomeWarning(o, "sourcing_failed"));
  assert.equal(changed, 1);
  const after = getLifecycle(id)!;
  assert.deepEqual(
    after.outcome?.warnings.map((w) => w.code),
    ["seed_skeleton_only", "baseline_unavailable"],
    "the sourcing warning is gone; the material warnings are preserved"
  );
  assert.equal(after.outcome?.code, "collecting_open");
  assert.equal(after.stage, before.stage, "the stage is not the re-source's to move");
  assert.equal(after.detail, before.detail, "the audit prose is untouched");
  // Idempotent: a second success has nothing to clear and writes nothing.
  assert.equal(rewriteLifecycleOutcomesForCase("case-ok", WS, (o) => withoutOutcomeWarning(o, "sourcing_failed")), 0);
});

test("3. store: scoped to the caller's team, and a row with no outcome is left alone", () => {
  const foreign = lifecycleWith("case-shared-id", failedOutcome(), OTHER);
  const bare = lifecycleWith("case-shared-id", undefined, WS);
  assert.equal(rewriteLifecycleOutcomesForCase("case-shared-id", WS, (o) => withoutOutcomeWarning(o, "sourcing_failed")), 0);
  assert.deepEqual(getLifecycle(foreign)!.outcome, failedOutcome(), "another team's lifecycle is never rewritten");
  assert.equal(getLifecycle(bare)!.outcome, null, "no outcome is not minted by a re-source");
});

test("4. route: the warning is cleared only after a successful seed, never on the failure path", () => {
  const src = readFileSync(path.join(ROOT, "app", "api", "devcase", "source", "route.ts"), "utf8");
  const seed = src.indexOf("seedPipelineFromMatches(matches");
  const clear = src.indexOf('withoutOutcomeWarning(o, "sourcing_failed")');
  const catchAt = src.indexOf("} catch (error)");
  assert.ok(seed > 0, "the route seeds the pipeline");
  assert.ok(clear > seed, "the clear runs after the seed succeeded");
  assert.ok(clear < catchAt, "the clear is on the success path, not in the catch (a failed re-source keeps the warning)");
  assert.match(src, /rewriteLifecycleOutcomesForCase\(devCase\.id, ws,/, "scoped to this case and the caller's team");
});
