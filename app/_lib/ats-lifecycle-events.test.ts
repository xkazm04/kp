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
