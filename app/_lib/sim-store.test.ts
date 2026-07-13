// bug-ui-scan-2026-07-09 (guided-pipeline-simulation #2): resetSim must purge ONLY
// the caller's tenant. The pre-fix DELETEs on `jobs`/`jds` were workspace-UNSCOPED,
// so a reset run by ANY workspace (an operator, or a demo session's auto-reset at
// run start) reached across the shared tables and destroyed another tenant's (SIM)
// rows. These proofs seed two workspaces' (SIM) artifacts, reset ONE, and assert the
// other survives — which FAILS against the pre-fix code (the cross-tenant job/jd was
// wrongly deleted there). Non-vacuity holds only because the "survives" assertions
// are on the OTHER workspace's rows, exactly what the unscoped DELETE clobbered.
//
// unit-db is the FIRST project import (throwaway KP_DB_PATH) — load-bearing order.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { openStore } from "./db-path.ts";
import { ensureDb } from "./db/core.ts";
import { resetSim } from "./sim-store.ts";
import { SIM_MARKER } from "@/app/features/simulation/constants";

after(() => cleanupUnitDb());

// Seed a (SIM)-marked job + pipeline_entry into a given workspace using the SAME
// connection resetSim opens, so there's no cross-connection visibility question.
function seedSimArtifacts(workspaceId: string, suffix: string): { jobId: string; entryId: string } {
  ensureDb(); // create the full schema (jobs/jds/pipeline_* columns incl. workspace_id)
  const d = openStore();
  const now = new Date().toISOString();
  const jobId = `job-${suffix}`;
  const entryId = `entry-${suffix}`;
  const title = `Backend Engineer ${SIM_MARKER}`;
  d.prepare(
    `INSERT INTO jobs (id, title, payload_json, status, workspace_id, created_at) VALUES (?, ?, ?, 'draft', ?, ?)`
  ).run(jobId, title, "{}", workspaceId, now);
  d.prepare(
    `INSERT INTO jds (slug, title, body, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)`
  ).run(`jd-${suffix}`, title, "body", now, workspaceId);
  d.prepare(
    `INSERT INTO pipeline_entries (id, candidate_id, candidate_label, archetype, job_id, job_title, stage, status, created_at, updated_at, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, 'Accepted', 'active', ?, ?, ?)`
  ).run(entryId, `cand-${suffix}`, `Candidate ${suffix}`, "generalist", jobId, title, now, now, workspaceId);
  return { jobId, entryId };
}

const jobExists = (id: string) => !!openStore().prepare(`SELECT 1 FROM jobs WHERE id = ?`).get(id);
const jdExists = (slug: string) => !!openStore().prepare(`SELECT 1 FROM jds WHERE slug = ?`).get(slug);
const entryExists = (id: string) => !!openStore().prepare(`SELECT 1 FROM pipeline_entries WHERE id = ?`).get(id);

test("resetSim purges ONLY the caller's workspace and cannot reach across tenants", () => {
  const mine = seedSimArtifacts("demo", "mine");
  const theirs = seedSimArtifacts("workspace", "theirs");

  const cleared = resetSim("demo");

  // The caller's own (SIM) artifacts are gone.
  assert.equal(entryExists(mine.entryId), false, "caller's sim entry should be purged");
  assert.equal(jobExists(mine.jobId), false, "caller's sim job should be purged");
  assert.equal(jdExists("jd-mine"), false, "caller's sim jd should be purged");

  // The OTHER tenant's artifacts survive — the crux the pre-fix unscoped DELETE broke.
  assert.equal(entryExists(theirs.entryId), true, "other tenant's sim entry must survive");
  assert.equal(jobExists(theirs.jobId), true, "other tenant's sim job must survive (unscoped DELETE would have removed it)");
  assert.equal(jdExists("jd-theirs"), true, "other tenant's sim jd must survive (unscoped DELETE would have removed it)");

  // The returned counts reflect the caller's tenant only (one of each).
  assert.equal(cleared.jobs, 1, "exactly the caller's one sim job counted");
  assert.equal(cleared.jds, 1, "exactly the caller's one sim jd counted");
  assert.equal(cleared.entries, 1, "exactly the caller's one sim entry counted");
});
