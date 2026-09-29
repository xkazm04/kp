// The role-fill hook: a role that has hired everyone it set out to hire retires itself.
//
// runRoleFillHook is the only actor for the brief's "open until the number of hired
// candidates is reached or until the role is closed manually", and until this file no
// test drove it: the compare-and-swap under it was pinned in job-workspace-state.test.ts
// and the hook's own decisions (stay open below the target, spare the hired, one sweep
// under a race) were pinned nowhere. These cases run the real function against a
// throwaway database.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ensureDb } from "./db/core.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { setRoleOpenConfig } from "./db/jobs.ts";
import { createPipelineEntry, getPipelineEntry } from "./db/pipeline.ts";
import { getJobStatus } from "./job-ingest.ts";
import { runRoleFillHook } from "./stage-hooks-role-fill.ts";

after(() => cleanupUnitDb());

const WS = DEFAULT_WORKSPACE_ID;

/** An authored, live role that states how many hires fill it. */
function openRole(id: string, targetHires: number): void {
  ensureDb()
    .prepare(
      `INSERT INTO jobs (id, title, payload_json, status, workspace_id, published_at, created_at)
       VALUES (?, ?, ?, 'published', ?, ?, ?)`
    )
    .run(id, id, JSON.stringify({ id, title: id }), WS, new Date().toISOString(), new Date().toISOString());
  setRoleOpenConfig(id, { targetHires }, WS);
}

function file(jobId: string, who: string, stage: string): string {
  return createPipelineEntry({
    candidateId: `${jobId}-${who}`,
    candidateLabel: who,
    jobId,
    jobTitle: jobId,
    stage,
    workspaceId: WS,
  }).entry.id;
}

const statusOf = (entryId: string) => getPipelineEntry(entryId, WS)?.status;
const roleClosedEvents = (jobId: string) =>
  (
    ensureDb()
      .prepare(`SELECT COUNT(*) AS n FROM pipeline_events e JOIN pipeline_entries p ON p.id = e.entry_id WHERE p.job_id = ? AND e.kind = 'role_closed'`)
      .get(jobId) as { n: number }
  ).n;

test("a one-seat role retires on its hire and withdraws the people still in flight, sparing the hired", async () => {
  openRole("rf-one", 1);
  const inFlight = [file("rf-one", "a", "Interview"), file("rf-one", "b", "Offer")];
  const hired = file("rf-one", "h", "Hired");

  const out = await runRoleFillHook({ entryId: hired, stage: "Hired", workspaceId: WS });

  assert.deepEqual(out, { outcome: "filled", hired: 1, target: 1, withdrawn: 2 });
  assert.equal(getJobStatus("rf-one", WS), "closed");
  assert.deepEqual(inFlight.map(statusOf), ["role_closed", "role_closed"]);
  assert.equal(statusOf(hired), "active", "the candidate the role was filled with is left alone");
});

test("a role short of its target stays live and withdraws nobody", async () => {
  openRole("rf-short", 3);
  const inFlight = [file("rf-short", "a", "Interview"), file("rf-short", "b", "Offer")];
  const h1 = file("rf-short", "h1", "Hired");

  const first = await runRoleFillHook({ entryId: h1, stage: "Hired", workspaceId: WS });
  assert.deepEqual(first, { outcome: "open", hired: 1, target: 3 });
  assert.equal(getJobStatus("rf-short", WS), "published");
  assert.deepEqual(inFlight.map(statusOf), ["active", "active"]);

  const h2 = file("rf-short", "h2", "Hired");
  assert.deepEqual(await runRoleFillHook({ entryId: h2, stage: "Hired", workspaceId: WS }), { outcome: "open", hired: 2, target: 3 });

  const h3 = file("rf-short", "h3", "Hired");
  assert.deepEqual(await runRoleFillHook({ entryId: h3, stage: "Hired", workspaceId: WS }), { outcome: "filled", hired: 3, target: 3, withdrawn: 2 });
  assert.equal(getJobStatus("rf-short", WS), "closed");
});

test("two hires committing at once retire the role once, and the withdrawal runs once", async () => {
  openRole("rf-race", 2);
  file("rf-race", "a", "Interview");
  file("rf-race", "b", "Offer");
  file("rf-race", "c", "Screened");
  const h1 = file("rf-race", "h1", "Hired");
  const h2 = file("rf-race", "h2", "Hired");

  const outcomes = await Promise.all([
    runRoleFillHook({ entryId: h1, stage: "Hired", workspaceId: WS }),
    runRoleFillHook({ entryId: h2, stage: "Hired", workspaceId: WS }),
  ]);

  const kinds = outcomes.map((o) => o.outcome).sort();
  assert.deepEqual(kinds, ["already_closed", "filled"], "exactly one call wins the swap");
  assert.equal(roleClosedEvents("rf-race"), 3, "each in-flight candidate is withdrawn once, by one sweep");
});

test("a rejected candidate sitting in the terminal column is not a hire", async () => {
  openRole("rf-rejected", 1);
  const id = file("rf-rejected", "r", "Hired");
  ensureDb().prepare(`UPDATE pipeline_entries SET status = 'rejected' WHERE id = ?`).run(id);

  const out = await runRoleFillHook({ entryId: id, stage: "Hired", workspaceId: WS });

  assert.deepEqual(out, { outcome: "skipped", reason: "terminal" });
  assert.equal(getJobStatus("rf-rejected", WS), "published");
});
