// bug-ui-scan-2026-07-09 #4 (end-to-end): a SINGLE-candidate group eval must NOT crown or
// auto-seal a lead, must NOT claim robustness, and must report "insufficient sample".
//
// NON-VACUITY: pre-fix, runGroupEval with one candidate set `lead = top`, sealed a
// `group_eval_lead`, and set robustness via assessRobustness(false, null) === "not_applicable"
// with a non-null topPick. The three assertions in the n=1 test below (no lead sealed,
// robustness === "insufficient_sample", topPick === null) each FAIL against that. The n=2
// test pins that a genuine field still crowns + seals a lead, so the floor didn't break the
// happy path.
//
// Drives the REAL runGroupEval against a throwaway DB — testing/unit-db.ts MUST be the
// FIRST project import (it sets KP_DB_PATH before any db-path import). Run: npm run test:unit
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

// Force the best-effort AI "compare all" spawn to fail fast (ENOENT → deterministic
// fallback), so the test is hermetic. Set BEFORE python-runner is loaded.
process.env.PYTHON_CMD = "kp-no-python-for-this-test";
const { runGroupEval } = await import("./group-eval-run.ts");
const { listDecisionRecords } = await import("./decision-record-store.ts");

after(() => cleanupUnitDb());

const candidate = (entryId: string, matchScore: number) => ({ entryId, candidateId: null, label: entryId, matchScore });
const sealedKinds = (entryId: string) => listDecisionRecords({ candidateRef: entryId }).map((r) => r.kind);

test("a single-candidate field is insufficient sample — no lead crowned, sealed, or robustness-claimed", async () => {
  const entryId = "solo-entry";
  const res = await runGroupEval({
    roleKey: "role-solo",
    roleTitle: "Backend Engineer",
    candidates: [candidate(entryId, 90)],
    governanceMode: "recommendation",
  });
  assert.equal(res.robustness, "insufficient_sample", "robustness must report insufficient sample, not a trivial pass");
  assert.equal(res.topPick, null, "no lead is crowned for a field of one");
  assert.deepEqual(res.differentiators, [], "no 'unique strengths' for a field of one");
  assert.match(String(res.summary), /insufficient sample/i);
  const kinds = sealedKinds(entryId);
  assert.ok(!kinds.includes("group_eval_lead"), `a single candidate must NOT auto-seal a lead, got [${kinds.join(", ")}]`);
  assert.ok(!kinds.includes("group_eval_advisory"), `nor an advisory record, got [${kinds.join(", ")}]`);
});

test("a two-candidate field clears the floor — a lead is crowned and sealed", async () => {
  const lead = "duo-lead";
  const res = await runGroupEval({
    roleKey: "role-duo",
    roleTitle: "Backend Engineer",
    candidates: [candidate(lead, 90), candidate("duo-rival", 40)],
    governanceMode: "recommendation",
  });
  assert.notEqual(res.robustness, "insufficient_sample", "a real field is comparable");
  assert.ok(res.topPick, "a lead is crowned once the field clears the floor");
  // The crown carries the lead's stable IDENTITY, not just its (non-unique) display
  // label — the modal keys the lead's "Unique strengths" chips on it, so with two
  // same-named candidates the label alone decorated the rival's tab.
  assert.equal((res.topPick as { entryId?: string }).entryId, lead, "topPick must carry the lead's entryId");
  const kinds = sealedKinds(lead);
  assert.ok(kinds.includes("group_eval_lead"), `recommendation over a real field auto-seals a lead, got [${kinds.join(", ")}]`);
});
