// A decline is a person overruling a machine proposal, so it holds the accept/reject
// rule: SEAL FIRST. When the chain cannot be written (keyed, then the key is lost) the
// single door answers the coded 503 and nothing is written; the advance stays queued.
// Its own file: it breaks the default chain. unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry, setApproval } = await import("../../_lib/db/pipeline.ts");
const { policyAdvanceDetail } = await import("../../_lib/approval-kinds.ts");
const { listDecisionRecords, sealDecisionRecord } = await import("../../_lib/decision-record-store.ts");
const { POST } = await import("./[id]/route.ts");

const KEY_ENV = "KP_DECISION_HMAC_KEY";
const priorKey = process.env[KEY_ENV];
after(() => {
  if (priorKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = priorKey;
  cleanupUnitDb();
});

process.env[KEY_ENV] = "decline-advance-seal-test-key";
sealDecisionRecord({ kind: "advanced", actor: "human:recruiter", policyVersion: "manual", candidateRef: "da-keying", rationale: "keys the chain", reasonCode: "accept", inputs: {} });
const { entry } = createPipelineEntry({ candidateId: "ds-c1", candidateLabel: "Decline Seal", jobId: "ds-job", jobTitle: "Decline Seal Role", stage: "Accepted", matchScore: 80 });
setApproval(entry.id, "screening_review", policyAdvanceDetail({ rationale: "score 80", toStage: "Screened", matchScore: 80 }));
delete process.env[KEY_ENV];

test("an unsealable decline answers PIPELINE_DECISION_NOT_SEALED 503 and writes nothing", async () => {
  const before = listPipelineEventsForEntry(entry.id).length;
  const res = await POST(
    new NextRequest(`http://localhost/api/pipeline/${entry.id}`, { method: "POST", body: JSON.stringify({ action: "decline_advance", expectedStage: "Accepted" }), headers: { "content-type": "application/json" } }),
    { params: Promise.resolve({ id: entry.id }) }
  );
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { code: string }).code, "PIPELINE_DECISION_NOT_SEALED");
  const e = getPipelineEntry(entry.id)!;
  assert.equal(e.approvalKind, "screening_review", "the advance is still queued");
  assert.equal(e.stage, "Accepted");
  assert.equal(e.status, "active");
  assert.equal(listPipelineEventsForEntry(entry.id).length, before, "no event written");
  assert.equal(listDecisionRecords({ candidateRef: entry.id }).length, 0);
});
