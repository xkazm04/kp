// Handler-level coverage for /api/pipeline/batch against an ISOLATED throwaway DB
// (testing/unit-db.ts must stay the first project import). Pins the batch
// move/decide contract: per-id CAS is preserved (a mismatched expectedStage is a
// per-id 409, not a batch abort), atomicity is PER ID (one item's refusal never
// stops the others), and the response reports each id's outcome — ok, or failed +
// the server's OWN refusal CODE (which the bar localizes), with the canonical
// English beside it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { createPipelineEntry, getPipelineEntry, setApproval } from "../../../_lib/db/pipeline.ts";

after(() => cleanupUnitDb());

const post = (body: unknown): Promise<Response> =>
  POST(
    new NextRequest("http://localhost/api/pipeline/batch", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );

let seq = 0;
function entryFixture(overrides: Partial<Parameters<typeof createPipelineEntry>[0]> = {}) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `batch-c${seq}`,
    candidateLabel: `Batch Candidate ${seq}`,
    jobId: `batch-job-${seq}`,
    jobTitle: "Batch Test Role",
    ...overrides,
  });
  return entry;
}

const outcome = (results: { id: string; ok: boolean; code?: string; reason?: string }[], id: string) =>
  results.find((r) => r.id === id)!;
const reasonOf = (results: { id: string; ok: boolean; code?: string; reason?: string }[], id: string) => String(outcome(results, id).reason);
// api-contracts.md 1.1 — the client renders the CODE, never the prose, so the code
// is what these assertions pin.
const codeOf = (results: { id: string; ok: boolean; code?: string; reason?: string }[], id: string) => outcome(results, id).code;

test("a mixed move batch: a clean move succeeds while a CAS conflict fails per-id (both reported), atomicity is per id", async () => {
  const clean = entryFixture({ stage: "Accepted" });
  const conflict = entryFixture({ stage: "Accepted" }); // we'll send a wrong expectedStage
  const alsoClean = entryFixture({ stage: "Screened" });

  const res = await post({
    items: [
      { id: clean.id, action: "set_stage", toStage: "Screened", expectedStage: "Accepted" },
      // Stale snapshot: the board thought this was at Interview — the CAS must lose.
      { id: conflict.id, action: "set_stage", toStage: "Offer", expectedStage: "Interview" },
      { id: alsoClean.id, action: "set_stage", toStage: "Interview", expectedStage: "Screened" },
    ],
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.total, 3);
  assert.equal(body.moved, 2, "the two clean moves land; the conflict does not");
  assert.equal(body.results.length, 3);

  assert.equal(outcome(body.results, clean.id).ok, true);
  assert.equal(outcome(body.results, alsoClean.id).ok, true);
  const conflictOut = outcome(body.results, conflict.id);
  assert.equal(conflictOut.ok, false);
  assert.equal(codeOf(body.results, conflict.id), "PIPELINE_MOVE_CONFLICT", "the server's own 409 refusal rides through as a code the board can localize");
  assert.match(reasonOf(body.results, conflict.id), /changed|refresh/i, "…with the canonical English beside it");

  // DB reflects exactly the two successful moves; the conflict is untouched.
  assert.equal(getPipelineEntry(clean.id)!.stage, "Screened");
  assert.equal(getPipelineEntry(alsoClean.id)!.stage, "Interview");
  assert.equal(getPipelineEntry(conflict.id)!.stage, "Accepted", "a per-id CAS miss must not move the row");
});

test("a batch decide: accept advances an active entry; a bare accept at Offer is refused per-id (422 reason)", async () => {
  const advance = entryFixture({ stage: "Screened" });
  const atOffer = entryFixture({ stage: "Offer" }); // no offer_review draft → the Hired guard fires

  const res = await post({
    items: [
      { id: advance.id, action: "accept", expectedStage: "Screened" },
      { id: atOffer.id, action: "accept", expectedStage: "Offer" },
    ],
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.moved, 1);
  assert.equal(outcome(body.results, advance.id).ok, true);
  const heldOut = outcome(body.results, atOffer.id);
  assert.equal(heldOut.ok, false);
  assert.equal(codeOf(body.results, atOffer.id), "PIPELINE_TERMINAL_NOT_ADVANCE", "the Hired-is-outcome-bearing 422 is surfaced as its own code");
  assert.match(reasonOf(body.results, atOffer.id), /accepts an offer/, "…with the canonical English beside it");

  assert.equal(getPipelineEntry(advance.id)!.stage, "Interview");
  assert.equal(getPipelineEntry(atOffer.id)!.stage, "Offer", "no phantom hire");
});

test("an offer_review accept EXTENDS the offer in a batch (parity with the single route), not a bare hire", async () => {
  const entry = entryFixture({ stage: "Offer" });
  setApproval(entry.id, "offer_review", JSON.stringify({ subject: "Offer", body: "Hi", recommended: 140000, currency: "CZK" }));

  const res = await post({ items: [{ id: entry.id, action: "accept", expectedStage: "Offer" }] });
  const body = await res.json();
  assert.equal(outcome(body.results, entry.id).ok, true, "approving the drafted offer succeeds");
  assert.equal(getPipelineEntry(entry.id)!.stage, "Offer", "extending an offer is not hiring");
  assert.equal(getPipelineEntry(entry.id)!.approvalKind, null, "the approval is consumed — now awaiting the candidate");
});

test("malformed and unknown-action items fail without aborting the valid ones", async () => {
  const good = entryFixture({ stage: "Accepted" });
  const res = await post({
    items: [
      { id: good.id, action: "set_stage", toStage: "Screened", expectedStage: "Accepted" },
      { action: "set_stage", toStage: "Screened" }, // missing id
      { id: "nope", action: "delete_everything" }, // unknown action
      { id: "ghost", action: "accept", expectedStage: "Screened" }, // not found
    ],
  });
  const body = await res.json();
  assert.equal(body.total, 4);
  assert.equal(body.moved, 1);
  assert.equal(outcome(body.results, good.id).ok, true);
  assert.equal(outcome(body.results, "nope").ok, false);
  assert.equal(outcome(body.results, "ghost").ok, false);
  assert.equal(codeOf(body.results, "ghost"), "PIPELINE_ENTRY_NOT_FOUND");
  // An unknown action never reaches the shared helper: the batch's own coercer
  // rejects the ROW, which is a different refusal from "this board has no such
  // action" and says so.
  assert.equal(codeOf(body.results, "nope"), "PIPELINE_BATCH_ITEM_MALFORMED");
  assert.equal(getPipelineEntry(good.id)!.stage, "Screened");
});

test("an empty or non-array items payload is a 400", async () => {
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ items: [] })).status, 400);
});
