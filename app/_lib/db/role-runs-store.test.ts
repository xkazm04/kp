// Import the REAL native better-sqlite3 first (never a shim), so every store call below
// opens a genuine on-disk SQLite file and runs the ACTUAL DDL this module ships.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file at
// module-eval time and must run BEFORE any module that transitively touches db-path.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  appendStageArtifact,
  getOrCreateRoleRun,
  getRoleRun,
  latestBranchArtifact,
  latestStageArtifact,
  listRoleRuns,
  listStageArtifacts,
  setRoleRunStatus,
} from "./role-runs.ts";
import { ensureDb } from "./core.ts";
import { RoleRunPiiError } from "../role-run-stages.ts";

const OTHER_WS = "ws-other";

before(() => {
  // Force the full ensureDb() init, then this module's own DDL.
  ensureDb();
  getOrCreateRoleRun({ jobId: "__init__" });
});
after(() => cleanupUnitDb());

test("a run is one row per (job, cycle) — a second call reads it back, never forks it", () => {
  const first = getOrCreateRoleRun({ jobId: "jd-role-a" });
  assert.equal(first.created, true);
  const second = getOrCreateRoleRun({ jobId: "jd-role-a" });
  assert.equal(second.created, false, "re-running a role must not fork a second ledger for it");
  assert.equal(second.run.id, first.run.id);

  // A different CYCLE is genuinely a different run of the same role.
  const nextCycle = getOrCreateRoleRun({ jobId: "jd-role-a", cycle: "2026-q4" });
  assert.equal(nextCycle.created, true);
  assert.notEqual(nextCycle.run.id, first.run.id);
  assert.equal(nextCycle.run.cycle, "2026-q4");
});

test("the unique index is real: a duplicate (ws, job, cycle) insert is rejected by the DB", () => {
  // NON-VACUITY for the test above — getOrCreateRoleRun's read-then-insert would look
  // identical if the index did not exist, and the guarantee would rest on nothing.
  const { run } = getOrCreateRoleRun({ jobId: "jd-role-unique" });
  assert.throws(
    () =>
      ensureDb()
        .prepare(`INSERT INTO role_runs (id, workspace_id, job_id, cycle, status, created_at) VALUES (?, ?, ?, ?, 'running', ?)`)
        .run("rr-forced-dup", run.workspaceId, "jd-role-unique", "1", new Date().toISOString()),
    /UNIQUE/i
  );
});

test("seq is the run's own clock: artifacts order across branches, not within them", () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-role-seq" });
  const a = appendStageArtifact({ runId: run.id, kind: "role_spec", status: "complete", payload: { jobId: "jd-role-seq" } });
  const b = appendStageArtifact({ runId: run.id, kind: "screen", branchRef: "m-one", status: "awaiting_approval", payload: { policyVersion: "p1" } });
  const c = appendStageArtifact({ runId: run.id, kind: "screen", branchRef: "m-two", status: "awaiting_approval", payload: { policyVersion: "p1" } });

  assert.deepEqual([a.seq, b.seq, c.seq], [1, 2, 3]);
  assert.deepEqual(
    listStageArtifacts(run.id).map((x) => [x.kind, x.branchRef]),
    [
      ["role_spec", null],
      ["screen", "m-one"],
      ["screen", "m-two"],
    ],
    "the run's whole history in one ordered read — which is what 'resume is a read' means"
  );
});

test("latest reads resolve the run-wide artifact and the per-branch artifact separately", () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-role-latest" });
  appendStageArtifact({ runId: run.id, kind: "slate", status: "complete", payload: { candidates: [], truncated: false } });
  appendStageArtifact({ runId: run.id, kind: "screen", branchRef: "m-one", status: "awaiting_approval", payload: { policyVersion: "p1" } });
  appendStageArtifact({ runId: run.id, kind: "screen", branchRef: "m-one", status: "complete", payload: { policyVersion: "p1", decision: "approved" } });

  // branchRef null must match IS NULL, not `= NULL` — SQLite answers "no rows" to the
  // latter without complaining, which would make every run-wide read silently empty.
  const slate = latestStageArtifact(run.id, "slate", null);
  assert.equal(slate?.kind, "slate");

  const screen = latestStageArtifact(run.id, "screen", "m-one");
  assert.equal(screen?.status, "complete", "the NEWEST artifact for the pair wins, not the first");
  assert.deepEqual((screen?.payload as { decision?: string })?.decision, "approved");

  assert.equal(latestStageArtifact(run.id, "screen", "m-missing"), null);
  assert.equal(latestBranchArtifact(run.id, "m-one")?.status, "complete");
});

test("the parked artifact survives its own resolution — the question is not erased by the answer", () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-role-append-only" });
  appendStageArtifact({ runId: run.id, kind: "interview", branchRef: "m-x", status: "awaiting_approval", payload: { invites: [] } });
  appendStageArtifact({ runId: run.id, kind: "interview", branchRef: "m-x", status: "complete", payload: { invites: [], decision: "approved" } });

  const history = listStageArtifacts(run.id).filter((a) => a.branchRef === "m-x");
  assert.equal(history.length, 2, "both the ask and the answer are in the ledger");
  assert.deepEqual(history.map((a) => a.status), ["awaiting_approval", "complete"]);
});

test("PII is refused at the write door, and nothing is written", () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-role-pii" });
  const before = listStageArtifacts(run.id).length;
  assert.throws(
    () =>
      appendStageArtifact({
        runId: run.id,
        kind: "slate",
        status: "complete",
        payload: { candidates: [{ candidateRef: "m-1", candidateLabel: "Jana Novakova", origin: "pool" }], truncated: false },
      }),
    (e: unknown) => e instanceof RoleRunPiiError
  );
  assert.equal(listStageArtifacts(run.id).length, before, "a refused write must leave no partial row");
});

test("an artifact cannot be appended to another tenant's run", () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-role-tenant" });
  assert.throws(
    () => appendStageArtifact({ runId: run.id, kind: "slate", status: "complete", payload: {} }, OTHER_WS),
    /does not exist in this workspace/
  );
  // And the run itself does not resolve across tenants.
  assert.equal(getRoleRun(run.id, OTHER_WS), null);
  assert.equal(getRoleRun(run.id)?.id, run.id, "positive control: it DOES resolve in its own workspace");
});

test("two tenants can run the same job id without seeing each other's ledger", () => {
  const mine = getOrCreateRoleRun({ jobId: "jd-shared" });
  const theirs = getOrCreateRoleRun({ jobId: "jd-shared" }, OTHER_WS);
  assert.notEqual(mine.run.id, theirs.run.id, "the unique index is per-workspace, so both runs exist");

  appendStageArtifact({ runId: theirs.run.id, kind: "slate", status: "complete", payload: { candidates: [], truncated: false } }, OTHER_WS);
  assert.equal(listStageArtifacts(theirs.run.id).length, 0, "read in the WRONG workspace: nothing");
  assert.equal(listStageArtifacts(theirs.run.id, OTHER_WS).length, 1, "positive control: read in its own workspace");

  assert.deepEqual(
    listRoleRuns({ jobId: "jd-shared" }).map((r) => r.id),
    [mine.run.id]
  );
});

test("the run row is a cursor and may move; an unknown status reads as running, not as a crash", () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-role-status" });
  assert.equal(run.status, "running");
  assert.equal(setRoleRunStatus(run.id, "complete")?.status, "complete");
  assert.equal(setRoleRunStatus(run.id, "complete", OTHER_WS), null, "a status move does not cross tenants");

  ensureDb().prepare(`UPDATE role_runs SET status = 'from-the-future' WHERE id = ?`).run(run.id);
  assert.equal(getRoleRun(run.id)?.status, "running", "a status this build does not know must not lose the run's history");
});

test("a stage row with an unrecognized kind is DROPPED from the read, never coerced", () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-role-unknown-kind" });
  appendStageArtifact({ runId: run.id, kind: "role_spec", status: "complete", payload: {} });
  ensureDb()
    .prepare(
      `INSERT INTO role_run_stages (id, run_id, workspace_id, kind, branch_ref, seq, status, payload_json, produced_at)
       VALUES (?, ?, 'workspace', 'reference_check', NULL, 99, 'complete', '{}', ?)`
    )
    .run("rrs-unknown", run.id, new Date().toISOString());

  const read = listStageArtifacts(run.id);
  assert.deepEqual(read.map((a) => a.kind), ["role_spec"], "coercing it would let the engine advance past a stage it never ran");
});
