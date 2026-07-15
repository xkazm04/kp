// decision-io-diet — pins listDecisionRecordsForRefs against the per-ref read it
// replaces. The reconsider queue and the analytics log used to call
// listDecisionRecords({candidateRef}) once per row (up to 50 SELECTs per load); the
// batched read must be BYTE-IDENTICAL per ref, with the limit applied PER REF (never a
// global cap across the batch) — the two properties the callers rely on.
//
// unit-db.ts MUST be the first project import (sets an isolated KP_DB_PATH before the
// store's db-path module evaluates). Bodies are synchronous (better-sqlite3 is sync).
import "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { UNIT_DB_PATH, cleanupUnitDb } from "./testing/unit-db.ts";
import { sealDecisionRecord, listDecisionRecords, listDecisionRecordsForRefs } from "./decision-record-store.ts";

after(() => cleanupUnitDb());

const WS = "workspace"; // DEFAULT_WORKSPACE_ID — what both callers pass for the default team

function seedEntry(id: string, workspaceId: string = WS): void {
  const d = new Database(UNIT_DB_PATH);
  d.exec(`CREATE TABLE IF NOT EXISTS pipeline_entries (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL DEFAULT 'workspace');`);
  d.prepare(`INSERT OR REPLACE INTO pipeline_entries (id, workspace_id) VALUES (?, ?)`).run(id, workspaceId);
  d.close();
}

let n = 0;
function seal(ref: string, kind = "auto_rejected"): void {
  n += 1;
  sealDecisionRecord({
    kind,
    actor: "auto:screen-wave",
    policyVersion: "screen-wave/test",
    candidateRef: ref,
    rationale: `record #${n} for ${ref}`,
    reasonCode: "reject",
    inputs: { score: 40 + n },
  });
}

// --- 1. Batched == per-ref, for every requested ref (byte-identical) ----------------
test("listDecisionRecordsForRefs is byte-identical to per-ref listDecisionRecords", () => {
  const refs = ["b-a", "b-b", "b-c", "b-missing"];
  refs.forEach((r) => seedEntry(r));
  // Two refs with MULTIPLE records each (the acceptance criterion's per-ref limit case),
  // one with a single record, one with none.
  seal("b-a");
  seal("b-b");
  seal("b-a");
  seal("b-c");
  seal("b-b");
  seal("b-a"); // b-a now has 3, b-b has 2, b-c has 1, b-missing has 0

  const batched = listDecisionRecordsForRefs(refs, { workspaceId: WS, limit: 20 });
  for (const ref of refs) {
    const perRef = listDecisionRecords({ candidateRef: ref, workspaceId: WS, limit: 20 });
    assert.deepEqual(batched.get(ref), perRef, `batched result for ${ref} must equal the per-ref read`);
  }
  // A ref with no records is present with an empty array (matches the per-ref contract).
  assert.deepEqual(batched.get("b-missing"), [], "a ref with no records maps to []");
});

// --- 2. The limit is PER REF, not a global cap across the batch ---------------------
// Two refs, each with more records than `limit`. A global LIMIT would starve one ref;
// per-ref semantics give EACH ref its own top-`limit` slice.
test("the limit applies per ref — two refs each keep their own top-N (not a shared budget)", () => {
  const refs = ["lim-x", "lim-y"];
  refs.forEach((r) => seedEntry(r));
  for (let i = 0; i < 4; i++) seal("lim-x");
  for (let i = 0; i < 4; i++) seal("lim-y");

  const batched = listDecisionRecordsForRefs(refs, { workspaceId: WS, limit: 2 });
  assert.equal(batched.get("lim-x")?.length, 2, "lim-x keeps its own 2 (limit not consumed by lim-y)");
  assert.equal(batched.get("lim-y")?.length, 2, "lim-y keeps its own 2 (limit not consumed by lim-x)");
  // And each slice is byte-identical to the per-ref LIMIT-2 read (newest first).
  for (const ref of refs) {
    assert.deepEqual(batched.get(ref), listDecisionRecords({ candidateRef: ref, workspaceId: WS, limit: 2 }));
  }
});

// --- 3. Empty input and workspace scoping -------------------------------------------
test("empty refs → empty map; other workspaces' records are never returned", () => {
  assert.equal(listDecisionRecordsForRefs([], { workspaceId: WS }).size, 0);

  seedEntry("ws-other", "team-2");
  seal("ws-other"); // seals onto team-2's chain (derived from the entry's workspace)
  const onDefault = listDecisionRecordsForRefs(["ws-other"], { workspaceId: WS });
  assert.deepEqual(onDefault.get("ws-other"), [], "a team-2 ref read under the default workspace yields nothing");
  const onTeam2 = listDecisionRecordsForRefs(["ws-other"], { workspaceId: "team-2" });
  assert.equal(onTeam2.get("ws-other")?.length, 1, "read under team-2 sees its own record");
});
