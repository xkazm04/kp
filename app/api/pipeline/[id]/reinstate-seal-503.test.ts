// The reinstate door answers a coded 503 when its decision record cannot be sealed, and
// the entry stays rejected (council robustness-1). The seal runs BEFORE the store commits,
// so the retry is not a 409: nothing moved. Seal failure is the REAL one: the chain is
// keyed, then the key is unset, so every seal throws.
//
// Its own file (own process, own throwaway DB): it breaks the default chain.
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const { actOnPipelineEntry, createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry } = await import("../../../_lib/db/pipeline.ts");
const { listDecisionRecords, sealDecisionRecord } = await import("../../../_lib/decision-record-store.ts");
const { POST } = await import("./route.ts");

const KEY_ENV = "KP_DECISION_HMAC_KEY";
const priorKey = process.env[KEY_ENV];
after(() => {
  if (priorKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = priorKey;
  cleanupUnitDb();
});

const post = (id: string, body: unknown): Promise<Response> =>
  POST(
    new NextRequest(`http://localhost/api/pipeline/${id}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id }) }
  );

let seq = 0;
function autoRejected(): string {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `rs-c${seq}`,
    candidateLabel: `Reinstate Seal ${seq}`,
    jobId: `rs-job-${seq}`,
    jobTitle: "Reinstate Seal Test",
    stage: "Screened",
  });
  actOnPipelineEntry(entry.id, "reject", undefined, { actor: "system", actorRef: "auto:screen-wave" });
  return entry.id;
}

process.env[KEY_ENV] = "reinstate-seal-test-key";
sealDecisionRecord({
  kind: "advanced",
  actor: "human:recruiter",
  policyVersion: "manual",
  candidateRef: "rs-keying",
  rationale: "keys the chain for this test",
  reasonCode: "accept",
  inputs: {},
});

const reinstated = (id: string) => listPipelineEventsForEntry(id).filter((e) => e.kind === "reinstated").length;
const sealed = (id: string) => listDecisionRecords({ candidateRef: id }).filter((r) => r.kind === "reinstated").length;

test("a failed seal answers the coded 503, the entry stays rejected, no restore event; the retry reinstates once", async () => {
  const id = autoRejected();
  delete process.env[KEY_ENV];
  const refused = await post(id, { action: "reinstate" });
  assert.equal(refused.status, 503);
  assert.equal(((await refused.json()) as { code?: string }).code, "PIPELINE_DECISION_NOT_SEALED");
  assert.equal(getPipelineEntry(id)!.status, "rejected", "the entry did not move");
  assert.equal(reinstated(id), 0, "no restore event is written");
  assert.equal(sealed(id), 0);

  process.env[KEY_ENV] = "reinstate-seal-test-key";
  const retried = await post(id, { action: "reinstate" });
  assert.equal(retried.status, 200, "the retry is not a 409");
  assert.equal(getPipelineEntry(id)!.status, "active");
  assert.equal(reinstated(id), 1, "exactly one reinstated event");
  assert.equal(sealed(id), 1, "exactly one sealed reversal");

  assert.equal((await post(id, { action: "reinstate" })).status, 409, "a double-click still 409s");
  assert.equal(sealed(id), 1);
});

test("happy path unchanged: 200, sealed restoredStage is the landed stage", async () => {
  const id = autoRejected();
  const res = await post(id, { action: "reinstate" });
  assert.equal(res.status, 200);
  const landed = ((await res.json()) as { entry: { stage: string } }).entry.stage;
  const seal = listDecisionRecords({ candidateRef: id }).find((r) => r.kind === "reinstated");
  assert.ok(seal);
  assert.equal((JSON.parse(seal.payloadJson) as { inputs: { restoredStage?: string } }).inputs.restoredStage, landed);
});
