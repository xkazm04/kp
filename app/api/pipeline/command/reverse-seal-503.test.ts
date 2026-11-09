// The command-bar undo seals each reversal BEFORE it restores (council failed-seal
// finding, same shape as the reinstate door dee24e63b): a failed seal leaves the entry
// rejected with no `reinstated` event, the wave carries on, `unsealed` counts it, an
// all-failed wave answers 503 PIPELINE_DECISION_NOT_SEALED, and the retry restores once.
//
// The seal failure is the REAL one: the chain is keyed, then the key is unset, so every
// seal throws. That breaks the default chain, so this lives in its own file (own process,
// own throwaway DB) beside reverse.test.ts. unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const { actOnPipelineEntry, createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry, reinstatePipelineEntry } = await import("../../../_lib/db/pipeline.ts");
const { listDecisionRecords, sealDecisionRecord } = await import("../../../_lib/decision-record-store.ts");
const { commandRejectDetail } = await import("../../../_lib/pipeline-command.ts");
const { reverseCommandWave } = await import("./reverse.ts");
const { POST } = await import("./reverse/route.ts");

const KEY_ENV = "KP_DECISION_HMAC_KEY";
const KEY = "undo-seal-test-key";
const priorKey = process.env[KEY_ENV];
after(() => {
  if (priorKey === undefined) delete process.env[KEY_ENV];
  else process.env[KEY_ENV] = priorKey;
  cleanupUnitDb();
});

const ACTOR = "human:Undo Sealer";

let seq = 0;
function waveRejected(stage = "Interview"): string {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `us-c${seq}`,
    candidateLabel: `Undo Seal ${seq}`,
    jobId: `us-job-${seq}`,
    jobTitle: "Undo Seal Test",
    stage,
    matchScore: 20,
  });
  const r = actOnPipelineEntry(entry.id, "reject", commandRejectDetail(40), { expectedStage: stage, actor: "human", actorRef: "human:recruiter" });
  assert.ok(r && r.status === "rejected", "fixture: the wave rejected the entry");
  return entry.id;
}

const reinstated = (id: string) => listPipelineEventsForEntry(id).filter((e) => e.kind === "reinstated").length;
const sealed = (id: string) => listDecisionRecords({ candidateRef: id }).filter((r) => r.kind === "reinstated").length;
const wave = (ids: string[]) => reverseCommandWave({ ids, threshold: 40, workspaceId: "workspace", actor: ACTOR });
const post = (ids: string[]): Promise<Response> =>
  POST(
    new NextRequest("http://localhost/api/pipeline/command/reverse", {
      method: "POST",
      body: JSON.stringify({ ids, threshold: 40 }),
      headers: { "content-type": "application/json" },
    })
  );

process.env[KEY_ENV] = KEY;
sealDecisionRecord({
  kind: "advanced",
  actor: "human:recruiter",
  policyVersion: "manual",
  candidateRef: "us-keying",
  rationale: "keys the chain for this test",
  reasonCode: "accept",
  inputs: {},
});

test("a failed seal leaves the entry rejected with no reinstated event and counts it unsealed; the retry restores exactly once", () => {
  const a = waveRejected();
  const b = waveRejected("Screened");
  delete process.env[KEY_ENV];
  const failed = wave([a, b]);
  assert.deepEqual(failed, { restored: 0, notified: 0, skipped: 2, unsealed: 2 });
  for (const id of [a, b]) {
    assert.equal(getPipelineEntry(id)!.status, "rejected", "nothing moved");
    assert.equal(reinstated(id), 0, "no restore event");
    assert.equal(sealed(id), 0);
  }

  process.env[KEY_ENV] = KEY;
  assert.deepEqual(wave([a, b]), { restored: 2, notified: 0, skipped: 0, unsealed: 0 });
  assert.equal(getPipelineEntry(a)!.stage, "Interview");
  for (const id of [a, b]) {
    assert.equal(getPipelineEntry(id)!.status, "active");
    assert.equal(reinstated(id), 1);
    assert.equal(sealed(id), 1, "exactly one sealed reversal per restored entry");
  }
  assert.deepEqual(wave([a, b]), { restored: 0, notified: 0, skipped: 2, unsealed: 0 }, "a second undo changes nothing");
  assert.equal(sealed(a), 1);
});

test("an entry that is no longer a wave member is never sealed", () => {
  const id = waveRejected();
  assert.ok(reinstatePipelineEntry(id, "workspace", "human:other"), "fixture: someone else reinstated first");
  assert.deepEqual(wave([id]), { restored: 0, notified: 0, skipped: 1, unsealed: 0 });
  assert.equal(sealed(id), 0, "no record for a reversal that did not happen");
});

test("POST answers 503 PIPELINE_DECISION_NOT_SEALED when nothing could be sealed, 200 with counts for a partial wave", async () => {
  const a = waveRejected();
  delete process.env[KEY_ENV];
  const refused = await post([a]);
  assert.equal(refused.status, 503);
  assert.equal(((await refused.json()) as { code?: string }).code, "PIPELINE_DECISION_NOT_SEALED");
  assert.equal(getPipelineEntry(a)!.status, "rejected");

  process.env[KEY_ENV] = KEY;
  const ok = await post([a]);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { restored: 1, notified: 0, skipped: 0, unsealed: 0 });
  assert.equal(sealed(a), 1);
});

test("a partial wave (one entry unsealable) answers 200 and leaves only that entry rejected", async () => {
  const good = waveRejected();
  const bad = waveRejected();
  // ONE entry's seal fails through the deps seam (the real chain is all-or-nothing).
  const real = await import("./reverse.ts");
  const out = real.reverseCommandWave(
    { ids: [good, bad], threshold: 40, workspaceId: "workspace", actor: ACTOR },
    {
      preview: real.previewCommandRejection,
      restore: real.restoreCommandRejection,
      invalidateGroupEval: () => undefined as never,
      seal: (input, ws) => (input.candidateRef === bad ? null : sealDecisionRecord(input, ws)),
    }
  );
  assert.deepEqual(out, { restored: 1, notified: 0, skipped: 1, unsealed: 1 });
  assert.equal(getPipelineEntry(good)!.status, "active");
  assert.equal(getPipelineEntry(bad)!.status, "rejected");
  assert.equal(reinstated(bad), 0);
  assert.equal(sealed(bad), 0);
});
