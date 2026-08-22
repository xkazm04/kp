// The two OUTCOME guards in runPipelineEntryAction, exercised against a
// WORKSPACE-COMPOSED board rather than only the shipped five columns.
//
// Both guards used to be expressed as "is the entry standing on the OFFER-role
// column". That is a proxy for the real rules, and it only holds on the shipped
// axis, where Offer immediately precedes Hired. validatePipelineStages requires
// only an entry stage and a terminal stage, so a workspace may legitimately:
//   (a) put a column BETWEEN offer and terminal, or
//   (b) carry no offer column at all,
// and under either shape the proxy answers the wrong question:
//   (a) a bare accept on the last pre-terminal column hand-set the outcome-bearing
//       terminal stage — the exact phantom hire the set_stage path 422s;
//   (b) `atOfferStage` was false EVERYWHERE, so approving a drafted offer never
//       reached extendDraftedOffer: it fell through to the generic advance, which
//       NULLs approval_detail — the drafted terms were destroyed and the candidate
//       was "hired" with no offer sent, no offers row and no acceptance.
//
// The shipped-axis cases below are the non-regression half: on the default board
// the new form is byte-identical to the old one.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store
// module resolves db-path.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, getPipelineEntry, setApproval } from "./db/pipeline.ts";
import { setDecisionConfig } from "./decision-config-store.ts";
import { runPipelineEntryAction } from "./pipeline-entry-action.ts";

after(() => cleanupUnitDb());

const ORIGIN = "http://localhost:3000";

let seq = 0;
function entryFixture(workspaceId: string, stage: string) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `ea-c${seq}`,
    candidateLabel: `Axis Candidate ${seq}`,
    jobId: `ea-job-${seq}`,
    jobTitle: "Axis Test Role",
    contact: `ea-c${seq}@example.com`,
    stage,
    workspaceId,
  }).entry;
}

const OFFER_DRAFT = JSON.stringify({ subject: "Offer", body: "Hi", recommended: 140000, currency: "CZK" });

// ---- (b) a board with NO offer column -------------------------------------
// Applied → Interview → Hired. Perfectly valid: entry first, terminal last.
const WS_NO_OFFER = "team-axis-no-offer";
setDecisionConfig(
  "pipelineStages",
  {
    stages: [
      { id: "Applied", label: "Applied", role: "entry" },
      { id: "Interview", label: "Interview", role: "interview" },
      { id: "Hired", label: "Hired", role: "terminal" },
    ],
    retired: [],
  },
  WS_NO_OFFER
);

test("no offer column: approving a drafted offer EXTENDS it instead of destroying the draft", async () => {
  const entry = entryFixture(WS_NO_OFFER, "Interview");
  setApproval(entry.id, "offer_review", OFFER_DRAFT, WS_NO_OFFER);

  const res = await runPipelineEntryAction({
    id: entry.id,
    action: "accept",
    expectedStage: "Interview",
    origin: ORIGIN,
    workspaceId: WS_NO_OFFER,
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.offerExtended, true, "the drafted offer must be extended to the candidate");
  assert.match(String(res.body.link), /\/offer\//, "the candidate gets a secure accept/decline link");
  const fresh = getPipelineEntry(entry.id, WS_NO_OFFER)!;
  assert.equal(fresh.stage, "Interview", "extending an offer is not hiring — the stage must not move");
  assert.notEqual(fresh.stage, "Hired", "no phantom hire without an accepted offer");
});

test("no offer column: a BARE accept on the last pre-terminal column is refused (422)", async () => {
  const entry = entryFixture(WS_NO_OFFER, "Interview");
  const res = await runPipelineEntryAction({
    id: entry.id,
    action: "accept",
    expectedStage: "Interview",
    origin: ORIGIN,
    workspaceId: WS_NO_OFFER,
  });
  assert.equal(res.status, 422);
  assert.match(String(res.body.error), /accepts an offer/);
  assert.equal(getPipelineEntry(entry.id, WS_NO_OFFER)!.stage, "Interview", "the entry must not move");
});

// ---- (a) a column BETWEEN offer and terminal ------------------------------
const WS_POST_OFFER = "team-axis-post-offer";
setDecisionConfig(
  "pipelineStages",
  {
    stages: [
      { id: "Applied", label: "Applied", role: "entry" },
      { id: "Screened", label: "Screened", role: "screening" },
      { id: "Interview", label: "Interview", role: "interview" },
      { id: "Offer", label: "Offer", role: "offer" },
      { id: "Reference check", label: "Reference check", role: "custom" },
      { id: "Hired", label: "Hired", role: "terminal" },
    ],
    retired: [],
  },
  WS_POST_OFFER
);

test("a column between offer and terminal: accept on it cannot hand-set the outcome (422)", async () => {
  const entry = entryFixture(WS_POST_OFFER, "Reference check");
  const res = await runPipelineEntryAction({
    id: entry.id,
    action: "accept",
    expectedStage: "Reference check",
    origin: ORIGIN,
    workspaceId: WS_POST_OFFER,
  });
  assert.equal(res.status, 422, "the terminal stage is reached only by an accepted offer");
  assert.equal(getPipelineEntry(entry.id, WS_POST_OFFER)!.stage, "Reference check");
});

test("a column between offer and terminal: the OFFER step itself still refuses a bare accept", async () => {
  const entry = entryFixture(WS_POST_OFFER, "Offer");
  const res = await runPipelineEntryAction({
    id: entry.id,
    action: "accept",
    expectedStage: "Offer",
    origin: ORIGIN,
    workspaceId: WS_POST_OFFER,
  });
  assert.equal(res.status, 422);
  assert.equal(getPipelineEntry(entry.id, WS_POST_OFFER)!.stage, "Offer");
});

test("a column between offer and terminal: a mid-funnel accept still advances normally", async () => {
  const entry = entryFixture(WS_POST_OFFER, "Screened");
  const res = await runPipelineEntryAction({
    id: entry.id,
    action: "accept",
    expectedStage: "Screened",
    origin: ORIGIN,
    workspaceId: WS_POST_OFFER,
  });
  assert.equal(res.status, 200);
  assert.equal(getPipelineEntry(entry.id, WS_POST_OFFER)!.stage, "Interview");
});

// ---- non-regression on the SHIPPED axis ------------------------------------
const WS_SHIPPED = "team-axis-shipped"; // no override → DEFAULT_STAGE_AXIS

test("shipped axis: a bare accept at Offer is still 422 and Interview still advances to Offer", async () => {
  const atOffer = entryFixture(WS_SHIPPED, "Offer");
  const refused = await runPipelineEntryAction({
    id: atOffer.id,
    action: "accept",
    expectedStage: "Offer",
    origin: ORIGIN,
    workspaceId: WS_SHIPPED,
  });
  assert.equal(refused.status, 422);
  assert.equal(getPipelineEntry(atOffer.id, WS_SHIPPED)!.stage, "Offer");

  const atInterview = entryFixture(WS_SHIPPED, "Interview");
  const advanced = await runPipelineEntryAction({
    id: atInterview.id,
    action: "accept",
    expectedStage: "Interview",
    origin: ORIGIN,
    workspaceId: WS_SHIPPED,
  });
  assert.equal(advanced.status, 200);
  assert.equal(getPipelineEntry(atInterview.id, WS_SHIPPED)!.stage, "Offer");
});

test("shipped axis: an accept on an entry ALREADY at the terminal stage stays a no-op clear, not a 422", async () => {
  // The store's own rule: at the last column there is no next stage, so accept just
  // consumes the approval without bumping stage_changed_at. The new guard must not
  // turn that into a refusal.
  const hired = entryFixture(WS_SHIPPED, "Hired");
  setApproval(hired.id, "decision", "", WS_SHIPPED);
  const res = await runPipelineEntryAction({
    id: hired.id,
    action: "accept",
    expectedStage: "Hired",
    origin: ORIGIN,
    workspaceId: WS_SHIPPED,
  });
  assert.equal(res.status, 200);
  const fresh = getPipelineEntry(hired.id, WS_SHIPPED)!;
  assert.equal(fresh.stage, "Hired");
  assert.equal(fresh.approvalKind, null, "the approval is consumed");
});

test("shipped axis: offer_review at Offer still extends (the legitimate path is unchanged)", async () => {
  const entry = entryFixture(WS_SHIPPED, "Offer");
  setApproval(entry.id, "offer_review", OFFER_DRAFT, WS_SHIPPED);
  const res = await runPipelineEntryAction({
    id: entry.id,
    action: "accept",
    expectedStage: "Offer",
    origin: ORIGIN,
    workspaceId: WS_SHIPPED,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.offerExtended, true);
  assert.equal(getPipelineEntry(entry.id, WS_SHIPPED)!.stage, "Offer");
});
