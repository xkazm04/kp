// A Match add whose verdict cannot be sealed files NOTHING (ADR 0018, the ADR 0017 rule).
//
// Driven through the REAL seal, the way decision-not-sealed.test.ts drives the commit
// door: the default workspace's decision chain is keyed, then the key is unset — the
// operational accident decision-record-store.ts refuses to paper over ("refusing to
// append an unkeyed (downgrade) row"). Every seal on that chain then fails, so a Match
// add must answer 503 PIPELINE_ADD_NOT_SEALED with no entry, no event and no record.
// Restoring the key makes the same add land — the refusal is retryable.
//
// Its own file (own process, own throwaway DB): breaking the default chain would break
// every other seal a shared file makes.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store module
// resolves db-path.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry } from "../../_lib/db/pipeline.ts";
import { listDecisionRecords, sealDecisionRecord } from "../../_lib/decision-record-store.ts";
import { MATCH_VERDICT_KIND } from "../../_lib/match-verdict.ts";

const KEY_ENV = "KP_DECISION_HMAC_KEY";
const priorKey = process.env[KEY_ENV];
after(() => {
  if (priorKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = priorKey;
  cleanupUnitDb();
});

const FACTS = {
  fitTier: "promising",
  best: { labelCode: "foundation", percent: 77 },
  worst: { labelCode: "fit", percent: 51 },
  matched: ["SQL"],
  unproven: [],
  missing: ["Spark"],
  matchScore: 64,
  scorerVersion: "match-scorer.v1",
};
const ADD = {
  candidateId: "mns-c1",
  candidateLabel: "Not Sealed Match",
  jobId: "mns-job-1",
  jobTitle: "Data Analyst",
  source: "match",
  approvalKind: "decision",
  matchScore: 64,
  matchFacts: FACTS,
};
const ENTRY_ID = `m-${ADD.candidateId}-${ADD.jobId}`;
const add = () =>
  POST(new NextRequest("http://localhost/api/pipeline", { method: "POST", body: JSON.stringify(ADD), headers: { "content-type": "application/json" } }));

// Key the default workspace's chain with one record, then lose the key.
process.env[KEY_ENV] = "match-add-not-sealed-test-key";
const keying = createPipelineEntry({ candidateId: "mns-key", candidateLabel: "Keys the chain", jobId: "mns-key-job", jobTitle: "Keying" }).entry;
sealDecisionRecord({
  kind: "advanced",
  actor: "human:recruiter",
  policyVersion: "manual",
  candidateRef: keying.id,
  rationale: "keys the chain for this test",
  reasonCode: "accept",
  inputs: {},
});
delete process.env[KEY_ENV];

test("a seal failure refuses the Match add with a coded 503 and files nothing", async () => {
  const res = await add();
  assert.equal(res.status, 503, "an add whose verdict has no record is not a 200");
  assert.equal((await res.json()).code, "PIPELINE_ADD_NOT_SEALED");
  assert.equal(getPipelineEntry(ENTRY_ID), null, "no entry was inserted");
  assert.deepEqual(listPipelineEventsForEntry(ENTRY_ID), [], "no 'added' event either");
  assert.equal(listDecisionRecords({ candidateRef: ENTRY_ID }).length, 0, "and no record");
});

test("restoring the key makes the same add land, sealed", async () => {
  process.env[KEY_ENV] = "match-add-not-sealed-test-key";
  try {
    const res = await add();
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { created: boolean }).created, true);
    const records = listDecisionRecords({ candidateRef: ENTRY_ID });
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, MATCH_VERDICT_KIND);
    assert.notEqual(records[0].keyId, "", "sealed under the restored key");
  } finally {
    delete process.env[KEY_ENV];
  }
});
