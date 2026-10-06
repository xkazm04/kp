// The integrations panel lets an operator subscribe to FOUR lifecycle events
// (SUBSCRIBABLE_EVENTS / integrationsWebhookIdentifiers.ts). Before this change exactly
// one of them could ever arrive: `dispatchAtsEvent` had a single call site in the tree
// (offer-finalize's hire), so `candidate.rejected`, `offer.accepted` and `offer.declined`
// were a menu of subscriptions that fired from nowhere — a connector built on the
// vocabulary kp publishes saw the hires and kept every rejected candidate open.
//
// These are BEHAVIOURAL: each flow is driven for real and the durable delivery ledger is
// the witness (a row per dispatch, opened synchronously before the first await, so it is
// present the moment the flow returns). The webhook host is a `.invalid` name — RFC 6761
// guarantees it never resolves — so the deliveries fail at DNS with no network, and the
// row's EXISTENCE, not its status, is what each test asserts.
//
// NON-VACUITY: pre-change, the three new assertions find no row at all (only the hire
// dispatches); the hire assertion is the control that proves the harness works.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any store
// module resolves db-path.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { setAtsConfig } from "./ats-config-store.ts";
import { listAtsDeliveries } from "./ats-delivery-store.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { createOffer } from "./offers-store.ts";
import { respondToOffer } from "./offer-finalize.ts";
import { runPipelineEntryAction } from "./pipeline-entry-action.ts";
import { runScreenWave } from "./screen-wave.ts";
import { SUBSCRIBABLE_EVENTS } from "./ats-webhook.ts";

after(() => cleanupUnitDb());

// Every subscribable event is subscribed, so a missing delivery means the emit site is
// missing — never that the operator had not asked for it.
setAtsConfig({ webhookUrl: "https://kp-nonexistent-webhook.invalid/hook", events: [...SUBSCRIBABLE_EVENTS] });

let seq = 0;
function entryAtOffer() {
  seq += 1;
  return createPipelineEntry({
    candidateId: `ats-ev-c${seq}`,
    candidateLabel: `ATS Event Candidate ${seq}`,
    jobId: `ats-ev-job-${seq}`,
    jobTitle: "ATS Event Role",
    stage: "Offer",
    contact: `ats-ev-c${seq}@example.com`,
  }).entry;
}

function eventsFor(entryId: string): string[] {
  return listAtsDeliveries(500)
    .filter((d) => d.entryId === entryId)
    .map((d) => d.event);
}

test("a recruiter REJECT dispatches candidate.rejected", async () => {
  const entry = createPipelineEntry({
    candidateId: "ats-ev-rej",
    candidateLabel: "ATS Event Rejected",
    jobId: "ats-ev-job-rej",
    jobTitle: "ATS Event Role",
    stage: "Screening",
    contact: "ats-ev-rej@example.com",
  }).entry;

  const res = await runPipelineEntryAction({
    id: entry.id,
    action: "reject",
    origin: "http://localhost:3000",
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  assert.equal(res.status, 200, "the reject itself must succeed (otherwise this proves nothing)");
  assert.deepEqual(eventsFor(entry.id), ["candidate.rejected"], "the rejection is mirrored to the ATS exactly once");
});

test("a candidate ACCEPT dispatches offer.accepted alongside candidate.hired", async () => {
  const entry = entryAtOffer();
  const offer = createOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    currency: "CZK",
    salary: 90_000,
    payload: { recommended: 90_000 },
  });

  const result = await respondToOffer(offer.token, "accept");
  assert.equal(result.ok, true);
  const events = eventsFor(entry.id).sort();
  // The hire is the pre-existing behaviour and the control; the offer response is a
  // DIFFERENT fact — a board with a stage after Offer would land on neither hire nor
  // notification, and the acceptance still has to reach the system of record.
  assert.deepEqual(events, ["candidate.hired", "offer.accepted"]);
});

test("a candidate DECLINE dispatches offer.declined", async () => {
  const entry = entryAtOffer();
  const offer = createOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    currency: "CZK",
    salary: 90_000,
    payload: { recommended: 90_000 },
  });

  const result = await respondToOffer(offer.token, "decline");
  assert.equal(result.ok, true);
  assert.deepEqual(eventsFor(entry.id), ["offer.declined"]);
});

test("a decline on a STALE link that changes nothing mirrors nothing", async () => {
  // The entry is already terminal, so markEntryStatus refuses the demotion and the
  // timeline gets no `offer_declined`. The webhook is held to the same truth: telling
  // the customer's ATS a hired candidate declined would be a lie kp cannot retract.
  const entry = createPipelineEntry({
    candidateId: "ats-ev-stale",
    candidateLabel: "ATS Event Stale",
    jobId: "ats-ev-job-stale",
    jobTitle: "ATS Event Role",
    stage: "Hired",
    contact: "ats-ev-stale@example.com",
  }).entry;
  const offer = createOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    currency: "CZK",
    salary: 90_000,
    payload: {},
  });

  await respondToOffer(offer.token, "decline");
  assert.deepEqual(eventsFor(entry.id), [], "no ledger row: nothing transitioned, so nothing is mirrored");
});

// The SECOND reject path. A human reject goes through runPipelineEntryAction (above);
// the screening wave commits its auto-rejects through actOnPipelineEntry directly and
// dispatches the candidate's comm beside it — and, until this test, nothing else. An
// operator subscribed to candidate.rejected saw every recruiter click and none of the
// wave, so the connector kept every auto-rejected candidate open. Same witness as the
// tests above — the delivery-ledger row — driven through the wave's real
// preview → approve → commit.
function seedScreened(jobId: string, label: string, matchScore: number) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `ats-ev-wave-c${seq}`,
    candidateLabel: label,
    jobId,
    jobTitle: "ATS Event Role",
    stage: "Screened",
    matchScore,
    archetype: "bau",
    contact: `ats-ev-wave-c${seq}@example.com`,
  }).entry;
}

test("a screening wave that auto-rejects N entries emits N candidate.rejected events — none for kept or spared ones", async () => {
  const jobId = "ats-ev-job-wave";
  const lowA = seedScreened(jobId, "ATS Wave Low A", 10);
  const lowB = seedScreened(jobId, "ATS Wave Low B", 12);
  const spared = seedScreened(jobId, "ATS Wave Spared", 14);
  const highA = seedScreened(jobId, "ATS Wave High A", 80);
  const highB = seedScreened(jobId, "ATS Wave High B", 90);

  const rule = { autoRejectEnabled: true, rejectBottomPercent: 60, maxMatchToReject: 45, holdoutPercent: 0 };
  const opts = { spare: [spared.id] };
  const preview = await runScreenWave(jobId, rule, { dryRun: true, ...opts });
  assert.deepEqual(
    preview.decisions.filter((d) => d.action === "reject").map((d) => d.entryId).sort(),
    [lowA.id, lowB.id].sort(),
    "the previewed set is exactly the two unspared low scorers (otherwise the commit below proves nothing)"
  );
  // A dry run applies nothing, so it may mirror nothing.
  assert.deepEqual(eventsFor(lowA.id), [], "a preview never reaches the ATS");

  const committed = await runScreenWave(jobId, rule, { dryRun: false, ...opts, approval: { approvedBy: "ATS Event Approver", token: preview.approvalToken } });
  assert.equal(committed.rejected, 2, "the wave must actually apply both rejects");
  assert.deepEqual(eventsFor(lowA.id), ["candidate.rejected"], "each auto-rejection is mirrored to the ATS exactly once");
  assert.deepEqual(eventsFor(lowB.id), ["candidate.rejected"], "each auto-rejection is mirrored to the ATS exactly once");
  for (const kept of [spared, highA, highB]) {
    assert.deepEqual(eventsFor(kept.id), [], `${kept.candidateLabel} was not rejected, so nothing is mirrored`);
  }
});

test("a screening-wave HOLDOUT entry (would-be reject, deliberately spared) mirrors nothing", async () => {
  const jobId = "ats-ev-job-wave-holdout";
  const low = seedScreened(jobId, "ATS Holdout Low", 10);
  seedScreened(jobId, "ATS Holdout High", 90);

  const rule = { autoRejectEnabled: true, rejectBottomPercent: 50, maxMatchToReject: 45, holdoutPercent: 100 };
  const preview = await runScreenWave(jobId, rule, { dryRun: true });
  assert.equal(preview.rejected, 0, "a 100% holdout spares every would-be reject (otherwise this test proves nothing)");
  const committed = await runScreenWave(jobId, rule, { dryRun: false, approval: { approvedBy: "ATS Event Approver", token: preview.approvalToken } });
  assert.equal(committed.rejected, 0);
  assert.deepEqual(eventsFor(low.id), [], "the holdout candidate stays active, so the ATS hears nothing");
});
