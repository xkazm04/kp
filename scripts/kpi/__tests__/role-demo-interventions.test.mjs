// Fixtures for the goal-3 reading's INTERVENTIONS count: a gate commit is an allowed act and is
// not counted against the run; a re-trigger after one is. The loop runs on a throwaway database
// with the keyless default runners (no --live, so nothing spawns a provider).
//
//   node --import ./scripts/test-alias-loader.mjs --experimental-transform-types \
//     --disable-warning=ExperimentalWarning --test scripts/kpi/__tests__/role-demo-interventions.test.mjs
import "better-sqlite3";
import { test, after } from "node:test";
import assert from "node:assert/strict";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH before anything touches db-path.
import { cleanupUnitDb } from "../../../app/_lib/testing/unit-db.ts";
process.env.KP_ROLE_DEMO_SCRATCH_DB = process.env.KP_DB_PATH;
import { insertJob } from "../../../app/_lib/job-ingest.ts";
import { ensureDb } from "../../../app/_lib/db/core.ts";
import { screenedLandingStage } from "../../../app/_lib/pipeline-stages.ts";
import { runDemoOnCopy } from "../role-demo-run-child.mjs";
import { summarizeInterventions } from "../role-demo-run-reading.mjs";

after(() => cleanupUnitDb());

test("summarizeInterventions: allowed codes are not outside the allowance, retrigger and other are", () => {
  const s = summarizeInterventions([{ code: "gate_commit" }, { code: "gate_commit" }, { code: "simulated_interview" }, { code: "retrigger" }, { code: "mystery" }]);
  assert.deepEqual(s.counts, { gate_commit: 2, simulated_interview: 1, retrigger: 1, other: 1 });
  assert.equal(s.interventionsOutsideAllowed, 2);
  assert.equal(summarizeInterventions([{ code: "gate_commit" }]).interventionsOutsideAllowed, 0);
  assert.equal(summarizeInterventions([]).interventionsOutsideAllowed, 0);
});

async function seedRole(tag, entryId) {
  const jobId = `jd-demo-iv-${tag}`;
  insertJob({ id: jobId, title: "Backend Engineer", requirements: [{ skill: "java", kind: "skill", hardness: "must" }] }, undefined, "published");
  // unit-db boots with the committed fixtures, so the pe-* row exists; re-point it at this job.
  const changed = ensureDb().prepare(`UPDATE pipeline_entries SET job_id = ?, job_title = ?, match_score = ?, stage = ?, status = 'active' WHERE id = ?`).run(jobId, "Backend Engineer", 90, screenedLandingStage(), entryId).changes;
  assert.equal(changed, 1);
  return jobId;
}

test("a run with no stand-in logs no intervention at all", async () => {
  const jobId = await seedRole("none", "pe-003");
  const record = await runDemoOnCopy({ jobId, standInMode: null });
  assert.equal(record.runnerSet, "default");
  assert.deepEqual(record.interventions, []);
});

test("a gate commit is logged but not an intervention outside the allowance; the pass after it is a retrigger", async () => {
  const jobId = await seedRole("commit", "pe-011");
  const record = await runDemoOnCopy({ jobId, standInMode: "policy", simCap: 0 });
  assert.equal(record.failure, null);
  const s = summarizeInterventions(record.interventions);
  assert.ok(s.counts.gate_commit > 0, "the stand-in committed at least one gate");
  assert.ok(s.counts.retrigger > 0, "a pass followed a gate commit");
  assert.equal(s.counts.other, 0);
  // The outside-allowed total is exactly the re-triggers: the commits contribute nothing to it.
  assert.equal(s.interventionsOutsideAllowed, s.counts.retrigger);
  // Every retrigger sits on a pass after the first.
  for (const i of record.interventions.filter((x) => x.code === "retrigger")) assert.ok(i.pass > 1);
});
