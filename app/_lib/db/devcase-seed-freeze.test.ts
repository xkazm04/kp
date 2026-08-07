// Import the REAL native better-sqlite3 first (never a shim), so every store call
// below opens a genuine on-disk SQLite file.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file (its
// own mkdtempSync dir — never ${process.pid}) at module-eval time, and it must run
// BEFORE any module that transitively touches db-path (devcase → core → db-path).
// Keep it above the app-module imports.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  saveDevCase,
  getDevCase,
  saveDevCaseSeed,
  saveDevCaseSeedIfAbsent,
  saveDevCaseScenarioIfAbsent,
  createPosting,
  getPostingByToken,
} from "./devcase.ts";

// FREEZE-AT-PUBLISH (bug-ui-scan-2026-07-09 #1). A published case's seed/scenario is
// the candidate-facing assignment; once the apply token is live, two candidates on the
// SAME case must be handed the IDENTICAL seed (and therefore the same submit channel).
// The orchestrator now materializes the seed ONCE, before minting the posting, and the
// lifecycle can never overwrite it after (saveDevCaseSeedIfAbsent is a compare-and-set
// that only fills an ABSENT column). These tests pin the freeze at the store seam the
// fix lives in, plus the apply-page read path (getPostingByToken → getDevCase.seed).
//
// Real DB (the store's own connection on a throwaway file). Full ensureDb() init runs
// on the first store call in before().

// A materialized seed shaped like the apply page reads ({files, note, source}).
const seedV1 = {
  files: [{ path: "src/index.ts", contents: "export const answer = 41; // v1\n" }],
  note: "Fix the off-by-one.",
  source: "llm",
};
// A DIFFERENT render — what a non-deterministic LLM would emit on a resume re-run.
const seedV2 = {
  files: [{ path: "src/index.ts", contents: "export const answer = 999; // v2\n" }],
  note: "Totally different assignment.",
  source: "llm",
};

const scenarioV1 = { phases: ["intro", "probe-a"], source: "llm" };
const scenarioV2 = { phases: ["intro", "probe-z"], source: "llm" };

/** A fresh approved dev case with no seed/scenario yet (the pre-materialization state). */
function freshCase(title: string): string {
  return saveDevCase({
    need: { title },
    analysis: {},
    role: { title: `${title} role` },
    case: { title: `${title} case` },
  }).id;
}

before(() => {
  // Force the full ensureDb() init (creates dev_cases WITH seed_json/scenario_json).
  getDevCase("__init__");
});

after(() => cleanupUnitDb());

test("publish freezes the seed: a resume cannot overwrite a live case's seed", () => {
  const caseId = freshCase("freeze-seed");

  // First run: materialize the seed ONCE, then mint the live token (posting).
  assert.equal(saveDevCaseSeedIfAbsent(caseId, seedV1), true, "first materialization writes");
  const posting = createPosting({
    caseId,
    channel: "local",
    token: "tok-freeze-seed",
    roleTitle: "r",
    caseTitle: "c",
  });
  assert.ok(posting.token, "token is now live");

  // Resume: the re-enqueued `approved` handler tries to re-materialize a fresh
  // (different) render. The compare-and-set must refuse — the column is no longer null.
  assert.equal(saveDevCaseSeedIfAbsent(caseId, seedV2), false, "resume does NOT re-write a frozen seed");

  // The live seed is still v1 — candidates who started before the resume and those who
  // start after get byte-identical materials.
  assert.deepEqual(getDevCase(caseId)!.seed, seedV1);
});

test("the apply page reads an identical frozen seed on every request", () => {
  const caseId = freshCase("apply-read");
  saveDevCaseSeedIfAbsent(caseId, seedV1);
  createPosting({ caseId, channel: "local", token: "tok-apply-read", roleTitle: "r", caseTitle: "c" });

  // Mirror app/devcase/apply/[token]/page.tsx exactly: token → posting.caseId → seed.
  const read = () => {
    const p = getPostingByToken("tok-apply-read")!;
    return getDevCase(p.caseId!)!.seed;
  };
  const first = read();
  // A resume fires between the two candidate requests — it must not change anything.
  assert.equal(saveDevCaseSeedIfAbsent(caseId, seedV2), false);
  const second = read();

  assert.deepEqual(first, seedV1);
  assert.deepEqual(second, seedV1);
  assert.deepEqual(first, second, "two apply-page reads return the identical seed");
});

test("the interview scenario is frozen the same way", () => {
  const caseId = freshCase("freeze-scenario");
  assert.equal(saveDevCaseScenarioIfAbsent(caseId, scenarioV1), true);
  assert.equal(saveDevCaseScenarioIfAbsent(caseId, scenarioV2), false, "resume does not re-write a frozen scenario");
  assert.deepEqual(getDevCase(caseId)!.scenario, scenarioV1);
});

// NON-VACUITY GUARD. This test documents (and pins) the PRE-FIX behavior the fix
// removes: the old orchestrator called the UNCONDITIONAL saveDevCaseSeed, which
// overwrites in place. If the orchestrator regressed to saveDevCaseSeed (or the
// IfAbsent guard were dropped), the three freeze tests above would fail — here we
// prove the unconditional writer really does mutate a live seed under the same
// resume, so those assertions are not vacuously true.
test("NON-VACUITY: the pre-fix unconditional saveDevCaseSeed DID swap a live seed", () => {
  const caseId = freshCase("prefix-overwrite");
  saveDevCaseSeed(caseId, seedV1);
  createPosting({ caseId, channel: "local", token: "tok-prefix", roleTitle: "r", caseTitle: "c" });
  // The pre-fix "resume" path: unconditional UPDATE clobbers the live seed.
  saveDevCaseSeed(caseId, seedV2);
  assert.deepEqual(getDevCase(caseId)!.seed, seedV2, "unconditional write overwrote the frozen seed (the bug)");
  assert.notDeepEqual(getDevCase(caseId)!.seed, seedV1);
});
