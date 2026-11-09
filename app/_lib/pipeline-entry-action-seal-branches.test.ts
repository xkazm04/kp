// The offer-extend and hybrid-handoff branches of runPipelineEntryAction hold the same
// rule as the generic accept/reject path: no record, no effect. A failed seal answers the
// coded 503 (PIPELINE_DECISION_NOT_SEALED) — never a 200 — and the retry, which takes the
// same branch again, ends with exactly ONE sealed record and the effect applied once.
// (council robustness-1, compliant-hiring-decision round 2.)
//
// unit-db.ts MUST be the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, getPipelineEntry, setApproval } from "./db/pipeline.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { listOffersForEntry } from "./offers-store.ts";
import { listDecisionRecords } from "./decision-record-store.ts";
import { setDecisionConfig } from "./decision-config-store.ts";
import { runPipelineEntryAction } from "./pipeline-entry-action.ts";

after(() => cleanupUnitDb());

const WS = "team-seal-branches";
const ORIGIN = "http://localhost:3000";
const failingSeal = () => null;

let seq = 0;
function entryAt(stage: string) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `seal-br-c${seq}`,
    candidateLabel: `Seal Branch ${seq}`,
    jobId: `seal-br-job-${seq}`,
    jobTitle: "Seal Branch Role",
    contact: `seal-br-${seq}@example.com`,
    stage,
    locale: "en",
    workspaceId: WS,
  }).entry;
}

const recordsOf = (id: string, kind: string) => listDecisionRecords({ candidateRef: id, workspaceId: WS }).filter((r) => r.kind === kind);

test("offer extend: a failed seal answers the coded 503 with NO letter, and the retry seals once and sends once", async () => {
  const entry = entryAt("Offer");
  setApproval(entry.id, "offer_review", JSON.stringify({ subject: "Offer", body: "Hi", recommended: 150000, currency: "CZK" }), WS);

  const refused = await runPipelineEntryAction(
    { id: entry.id, action: "accept", expectedStage: "Offer", origin: ORIGIN, workspaceId: WS },
    { seal: failingSeal }
  );
  assert.equal(refused.status, 503);
  assert.equal(refused.body.code, "PIPELINE_DECISION_NOT_SEALED");
  assert.deepEqual(listOutboxFiltered({ ref: entry.id, kind: "offer" }, WS), [], "no letter went out");
  assert.equal(recordsOf(entry.id, "offer_terms").length, 0);
  assert.equal(getPipelineEntry(entry.id, WS)!.approvalKind, "offer_review", "the approval stays on the card");

  // The offer WAS minted (created=true) before the seal failed: the retry sees
  // created=false, updated=false and must still seal.
  assert.equal(listOffersForEntry(entry.id).length, 1);
  const retried = await runPipelineEntryAction({ id: entry.id, action: "accept", expectedStage: "Offer", origin: ORIGIN, workspaceId: WS });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.offerExtended, true);
  assert.equal(recordsOf(entry.id, "offer_terms").length, 1, "exactly one sealed record");
  assert.equal(listOffersForEntry(entry.id).length, 1, "still one offer, one link");
  assert.equal(listOutboxFiltered({ ref: entry.id, kind: "offer" }, WS).length, 1, "exactly one letter");
});

test("hybrid handoff: a failed seal answers the coded 503 and changes nothing, and the retry hands off once", async () => {
  setDecisionConfig(
    "interviewPlan",
    {
      steps: [
        {
          stageId: "Interview",
          gate: "human",
          rounds: [
            { kind: "ai", gate: "human", topN: null },
            { kind: "human", gate: "human", topN: null },
          ],
        },
      ],
    },
    WS
  );
  const entry = entryAt("Interview");
  setApproval(entry.id, "scorecard_review", JSON.stringify({ source: "ai", recommendation: "advance", ratings: [] }), WS);

  const refused = await runPipelineEntryAction(
    { id: entry.id, action: "accept", expectedStage: "Interview", origin: ORIGIN, workspaceId: WS },
    { seal: failingSeal }
  );
  assert.equal(refused.status, 503);
  assert.equal(refused.body.code, "PIPELINE_DECISION_NOT_SEALED");
  assert.equal(getPipelineEntry(entry.id, WS)!.approvalKind, "scorecard_review", "the gate was not re-armed");
  assert.equal(recordsOf(entry.id, "advanced").length, 0);

  const retried = await runPipelineEntryAction({ id: entry.id, action: "accept", expectedStage: "Interview", origin: ORIGIN, workspaceId: WS });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.routedToHumanRound, true);
  assert.equal(getPipelineEntry(entry.id, WS)!.approvalKind, "calendar");
  assert.equal(recordsOf(entry.id, "advanced").length, 1, "exactly one sealed record");
});
