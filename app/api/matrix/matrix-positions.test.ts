// "Rank in matrix" on a role with no pipeline entries: the position-building step of
// GET /api/matrix. The pure step is tested against the real store lookup that feeds it,
// so a closed, a filled and another workspace's role are refused for the right reason.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { ensureDb, type JobRecord } from "../../_lib/db/core.ts";
import { getRoleStatusForWorkspace } from "../../_lib/db/jobs.ts";
import { insertJob } from "../../_lib/job-ingest.ts";
import { withScopedPosition, type MatrixPosition } from "./matrix-positions.ts";

after(() => cleanupUnitDb());

const WS = "ws-matrix-scope";
const OTHER = "ws-matrix-other";

function role(id: string, ws: string, status: string): void {
  insertJob({ id, title: `Title ${id}`, roleFamily: "fx-fam" } as unknown as JobRecord, undefined, status, ws);
}

role("fx-open", WS, "published");
role("fx-draft", WS, "draft");
role("fx-closed", WS, "closed");
role("fx-filled", WS, "published");
role("fx-foreign", OTHER, "published");
ensureDb()
  .prepare(`INSERT INTO pipeline_entries (id, candidate_label, job_id, stage, workspace_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
  .run("fx-pe-1", "Hired Person", "fx-filled", "Hired", WS, new Date().toISOString());

const inPipeline: MatrixPosition[] = [{ id: "pipe-1", title: "Zeta", roleFamily: "eng" }];
const requested = (id: string) => withScopedPosition(inPipeline, getRoleStatusForWorkspace(id, WS));

test("an open role with no pipeline entries, requested by job, becomes a position", () => {
  const out = requested("fx-open");
  assert.deepEqual(out.map((p) => p.id), ["fx-open", "pipe-1"]);
  assert.equal(out[0]!.title, "Title fx-open");
});

test("a draft role is ranked too", () => {
  assert.ok(requested("fx-draft").some((p) => p.id === "fx-draft"));
});

test("a closed role, a filled role and another workspace's role are not added", () => {
  assert.equal(getRoleStatusForWorkspace("fx-closed", WS)?.status, "closed");
  assert.equal(getRoleStatusForWorkspace("fx-filled", WS)?.status, "filled");
  assert.equal(getRoleStatusForWorkspace("fx-foreign", WS), null);
  for (const id of ["fx-closed", "fx-filled", "fx-foreign", "fx-nonexistent"]) {
    assert.deepEqual(requested(id), inPipeline, id);
  }
});

test("a role already a position is not duplicated, and no ?job= leaves the default columns", () => {
  assert.deepEqual(withScopedPosition(inPipeline, { id: "pipe-1", title: "Zeta", roleFamily: "eng", status: "open" }), inPipeline);
  assert.deepEqual(withScopedPosition(inPipeline, null), inPipeline);
});
