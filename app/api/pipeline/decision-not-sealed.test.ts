// The three doors that share runPipelineEntryAction must REPORT a decision that was
// not sealed as a failure (council d676869f, line 3: "a failed seal on the
// recruiter's commit door still gets a 200, and only a server log records it").
//
// The core seals an accept/reject BEFORE the write and refuses with a coded 503
// (PIPELINE_DECISION_NOT_SEALED) when the record cannot be written. This file drives
// that refusal through the REAL seal rather than an injected one: the default
// workspace's decision chain is keyed, then the key is unset — the operational
// accident decision-record-store.ts refuses to paper over ("refusing to append an
// unkeyed (downgrade) row"). Every seal on that chain then fails, so:
//   - the single route answers the 503 itself;
//   - the batch route reports each row ok:false with the code;
//   - the command bar counts each target as `failed`, never as done;
// and in every case the entry keeps its state and no rejection letter is queued.
// Restoring the key makes the same decision land — the refusal is retryable.
//
// Its own file (own process, own throwaway DB): breaking the default chain would
// break every other seal a shared file makes.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store
// module resolves db-path.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { POST as postEntry } from "./[id]/route.ts";
import { POST as postBatch } from "./batch/route.ts";
import { executeCommandTargets } from "./command/execute.ts";
import { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry } from "../../_lib/db/pipeline.ts";
import { listOutboxFiltered } from "../../_lib/db/devcase.ts";
import { listDecisionRecords, sealDecisionRecord } from "../../_lib/decision-record-store.ts";

const KEY_ENV = "KP_DECISION_HMAC_KEY";
const priorKey = process.env[KEY_ENV];
after(() => {
  if (priorKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = priorKey;
  cleanupUnitDb();
});

const ORIGIN = "http://localhost";

let seq = 0;
function entryFixture(stage = "Screened") {
  seq += 1;
  return createPipelineEntry({
    candidateId: `ns-c${seq}`,
    candidateLabel: `Not Sealed ${seq}`,
    jobId: `ns-job-${seq}`,
    jobTitle: "Not Sealed Role",
    contact: `ns-c${seq}@example.com`,
    stage,
    matchScore: 20,
  }).entry;
}

// Key the default workspace's chain with one record, then lose the key: from here on
// every seal on that chain throws inside sealDecisionRecord and sealDecisionSafe
// answers null — a real seal failure, not a stubbed one.
process.env[KEY_ENV] = "decision-not-sealed-test-key";
const keyingEntry = entryFixture();
sealDecisionRecord({
  kind: "advanced",
  actor: "human:recruiter",
  policyVersion: "manual",
  candidateRef: keyingEntry.id,
  rationale: "keys the chain for this test",
  reasonCode: "accept",
  inputs: {},
});
delete process.env[KEY_ENV];

const rejectionLetters = (id: string) => listOutboxFiltered({ ref: id, kind: "rejection" });
const recordsFor = (id: string) => listDecisionRecords({ candidateRef: id });

function assertUntouched(id: string, label: string) {
  const fresh = getPipelineEntry(id)!;
  assert.equal(fresh.status, "active", `${label}: the candidate was not rejected`);
  assert.equal(fresh.stage, "Screened", `${label}: the entry kept its stage`);
  const kinds = listPipelineEventsForEntry(id).map((e) => e.kind);
  assert.ok(!kinds.includes("rejected") && !kinds.includes("rejection_comms_failed"), `${label}: no decision event (got ${kinds.join(",")})`);
  assert.deepEqual(rejectionLetters(id), [], `${label}: no rejection letter was queued`);
  assert.equal(recordsFor(id).length, 0, `${label}: nothing was sealed`);
}

test("the single route answers the coded 503 with the fresh entry, and changes nothing", async () => {
  const entry = entryFixture();
  const res = await postEntry(
    new NextRequest(`${ORIGIN}/api/pipeline/${entry.id}`, {
      method: "POST",
      body: JSON.stringify({ action: "reject", expectedStage: "Screened" }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: entry.id }) }
  );
  assert.equal(res.status, 503, "a decision with no record is not a 200");
  const body = (await res.json()) as { code?: string; entry?: { id?: string; status?: string } };
  assert.equal(body.code, "PIPELINE_DECISION_NOT_SEALED");
  assert.equal(body.entry?.id, entry.id);
  assert.equal(body.entry?.status, "active");
  assertUntouched(entry.id, "single route");
});

test("(6) the batch route reports a row that was not sealed as failed, with the code", async () => {
  const a = entryFixture();
  const b = entryFixture();
  const res = await postBatch(
    new NextRequest(`${ORIGIN}/api/pipeline/batch`, {
      method: "POST",
      body: JSON.stringify({
        items: [
          { id: a.id, action: "reject", expectedStage: "Screened" },
          { id: b.id, action: "accept", expectedStage: "Screened" },
        ],
      }),
      headers: { "content-type": "application/json" },
    })
  );
  assert.equal(res.status, 200, "the batch itself answered; its rows carry the outcome");
  const body = (await res.json()) as { moved: number; total: number; results: { id: string; ok: boolean; code?: string }[] };
  assert.equal(body.total, 2);
  assert.equal(body.moved, 0, "nothing the chain did not record is counted as moved");
  for (const id of [a.id, b.id]) {
    const row = body.results.find((r) => r.id === id)!;
    assert.equal(row.ok, false);
    assert.equal(row.code, "PIPELINE_DECISION_NOT_SEALED");
  }
  assertUntouched(a.id, "batch reject");
  assert.equal(getPipelineEntry(b.id)!.stage, "Screened", "batch accept: the entry did not advance");
});

test("(7) the command bar counts a target that was not sealed as failed, never as done", async () => {
  const targets = [entryFixture(), entryFixture()];
  const counts = await executeCommandTargets({ kind: "reject_below", threshold: 40, targets, workspaceId: "workspace", origin: ORIGIN });
  assert.equal(counts.count, 0, "no rejection is reported as applied");
  assert.equal(counts.failed, 2, "each unsealed target is a failure the recruiter is told about");
  assert.equal(counts.commsFailed, 0, "no letter was attempted, so none failed");
  for (const t of targets) assertUntouched(t.id, "command bar");
});

test("the refusal is retryable: once the chain is writable the same reject seals and lands", async () => {
  const entry = entryFixture();
  process.env[KEY_ENV] = "decision-not-sealed-test-key";
  try {
    const res = await postEntry(
      new NextRequest(`${ORIGIN}/api/pipeline/${entry.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "reject", expectedStage: "Screened" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: entry.id }) }
    );
    assert.equal(res.status, 200);
    assert.equal(getPipelineEntry(entry.id)!.status, "rejected");
    const records = recordsFor(entry.id);
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, "rejected");
  } finally {
    delete process.env[KEY_ENV];
  }
});
