// The decline door (Q2): a person keeps a QUEUED POLICY ADVANCE where it is. Both
// doors that share runPipelineEntryAction (the single route and the batch route)
// must (a) leave the entry in its stage and status with no approval, (b) seal the
// decision as a human's under its own kind, (c) not be re-proposed by the pass in
// that stage, and (d) refuse anything that is not a queued advance with a coded 409
// and change nothing (never fall through to reject).
//
// unit-db.ts MUST be the first project import.
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as postEntry } from "./[id]/route.ts";
import { POST as postBatch } from "./batch/route.ts";
import { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry, setApproval } from "../../_lib/db/pipeline.ts";
import { runAutomationPass } from "../../_lib/automation-pass.ts";
import { listDecisionRecords } from "../../_lib/decision-record-store.ts";

after(() => cleanupUnitDb());

const entryPost = (id: string, body: unknown): Promise<Response> =>
  postEntry(
    new NextRequest(`http://localhost/api/pipeline/${id}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    { params: Promise.resolve({ id }) }
  );
const batchPost = (body: unknown): Promise<Response> =>
  postBatch(new NextRequest("http://localhost/api/pipeline/batch", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

let seq = 0;
function seed(stage = "Accepted"): string {
  seq += 1;
  return createPipelineEntry({
    candidateId: `da-c${seq}`,
    candidateLabel: `Decline Advance ${seq}`,
    archetype: "bau",
    jobId: `da-job-${seq}`,
    jobTitle: "Decline Advance Role",
    stage,
    matchScore: 80,
    contact: `da-c${seq}@example.invalid`,
  }).entry.id;
}
async function queued(stage = "Accepted"): Promise<string> {
  const id = seed(stage);
  await runAutomationPass();
  assert.equal(getPipelineEntry(id)!.approvalKind, "screening_review", "non-vacuity: the pass queued the advance");
  return id;
}
const records = (id: string) => listDecisionRecords({ candidateRef: id });

function assertKeptInPlace(id: string, stage: string) {
  const e = getPipelineEntry(id)!;
  assert.equal(e.stage, stage, "stays in its stage");
  assert.equal(e.status, "active", "a decline is not a rejection");
  assert.equal(e.approvalKind, null, "no approval left pending");
}

test("single door: decline keeps the entry in place, seals a human advance_declined, and the pass does not re-propose", async () => {
  const id = await queued();
  const res = await entryPost(id, { action: "decline_advance", expectedStage: "Accepted", actor: "sim" });
  assert.equal(res.status, 200);
  assertKeptInPlace(id, "Accepted");
  const [rec] = records(id);
  assert.equal(rec.kind, "advance_declined");
  assert.match(rec.actor, /^human/, "the engine claim in the body is ignored");
  assert.ok(!listPipelineEventsForEntry(id).some((e) => e.kind === "rejected"), "no reject event");

  await runAutomationPass();
  assertKeptInPlace(id, "Accepted");
  assert.equal(listPipelineEventsForEntry(id).filter((e) => e.kind === "approval_set").length, 1, "not queued a second time");
});

test("batch door: decline keeps the entry in place and is sealed; a non-advance in the same batch is refused and unchanged", async () => {
  const adv = await queued();
  const plain = seed("Screened");
  const review = seed("Screened");
  setApproval(review, "screening_review", JSON.stringify({ recommendation: "hold" }));
  const res = await batchPost({
    items: [
      { id: adv, action: "decline_advance", expectedStage: "Accepted" },
      { id: plain, action: "decline_advance", expectedStage: "Screened" },
      { id: review, action: "decline_advance", expectedStage: "Screened" },
    ],
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { results: { id: string; ok: boolean; code?: string }[] };
  const by = (id: string) => body.results.find((r) => r.id === id)!;
  assert.equal(by(adv).ok, true);
  assertKeptInPlace(adv, "Accepted");
  assert.equal(records(adv)[0].kind, "advance_declined");
  for (const id of [plain, review]) {
    assert.equal(by(id).ok, false);
    assert.equal(by(id).code, "PIPELINE_NO_QUEUED_ADVANCE");
    assert.equal(getPipelineEntry(id)!.status, "active", "never falls through to reject");
    assert.equal(getPipelineEntry(id)!.stage, "Screened");
    assert.equal(records(id).length, 0, "nothing sealed for a refusal");
  }
  assert.equal(getPipelineEntry(review)!.approvalKind, "screening_review", "another approval is untouched");
});

test("single door: a non-advance entry answers the coded 409 and is unchanged; a stale stage is a 409 too", async () => {
  const plain = seed("Screened");
  const res = await entryPost(plain, { action: "decline_advance" });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { code: string }).code, "PIPELINE_NO_QUEUED_ADVANCE");
  assert.equal(getPipelineEntry(plain)!.status, "active");
  assert.equal(records(plain).length, 0);

  const id = await queued();
  const stale = await entryPost(id, { action: "decline_advance", expectedStage: "Interview" });
  assert.equal(stale.status, 409);
  assert.equal(getPipelineEntry(id)!.approvalKind, "screening_review", "a stale decline changes nothing");
});
