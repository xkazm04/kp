// offer-finalize guards on the candidate's answer (scan 2026-11-08, findings 3 and 4).
// Behavioural, against an isolated DB; the ATS delivery ledger is the witness for
// what was mirrored (a `.invalid` webhook host never resolves, so the row's
// EXISTENCE is the assertion). unit-db.ts MUST be the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { setAtsConfig } from "./ats-config-store.ts";
import { listAtsDeliveries } from "./ats-delivery-store.ts";
import { createPipelineEntry, getPipelineEntry, hasEvent } from "./db/pipeline.ts";
import { createOffer, getOfferByToken, markEntryStatus } from "./offers-store.ts";
import { respondToOffer } from "./offer-finalize.ts";
import { SUBSCRIBABLE_EVENTS } from "./ats-webhook.ts";
import { billingOverview } from "./billing/entitlements.ts";

after(() => cleanupUnitDb());

setAtsConfig({ webhookUrl: "https://kp-nonexistent-webhook.invalid/hook", events: [...SUBSCRIBABLE_EVENTS] });

let seq = 0;
function entryAt(stage: string, jobTitle = "Finalize Role") {
  seq += 1;
  return createPipelineEntry({
    candidateId: `fin-c${seq}`,
    candidateLabel: `Finalize Candidate ${seq}`,
    jobId: `fin-job-${seq}`,
    jobTitle,
    stage,
    contact: `fin-c${seq}@example.com`,
  }).entry;
}

function mint(entryId: string, jobTitle = "Finalize Role") {
  return createOffer({
    entryId,
    candidateLabel: "Finalize Candidate",
    jobId: null,
    jobTitle,
    currency: "CZK",
    salary: 80_000,
    payload: { recommended: 80_000 },
    ttlDays: 7,
  });
}

const deliveries = (entryId: string) => listAtsDeliveries(500).filter((d) => d.entryId === entryId).map((d) => d.event);

test("accepting an offer on a CLOSED entry is refused, unclaimed, and tells the ATS nothing", async () => {
  const entry = entryAt("Offer");
  const offer = mint(entry.id);
  assert.ok(markEntryStatus(entry.id, "rejected"), "precondition: the entry is closed while the link is live");

  const res = await respondToOffer(offer.token!, "accept");
  assert.deepEqual(res, { ok: false, code: "OFFER_NO_LONGER_OPEN" });
  assert.equal(getOfferByToken(offer.token!)!.status, "extended", "the refused offer is not claimed");
  assert.equal(hasEvent(entry.id, "offer_accepted"), false);
  assert.deepEqual(deliveries(entry.id), [], "no offer.accepted for a hire that did not happen");
});

test("accepting an offer whose entry was moved back off the offer step is refused", async () => {
  const entry = entryAt("Screening");
  const offer = mint(entry.id);

  const res = await respondToOffer(offer.token!, "accept");
  assert.deepEqual(res, { ok: false, code: "OFFER_NO_LONGER_OPEN" });
  assert.equal(getOfferByToken(offer.token!)!.status, "extended");
  assert.equal(getPipelineEntry(entry.id)!.stage, "Screening", "the entry is not advanced from wherever it stands");
});

test("an accept on a live offer-stage entry still hires and mirrors both events", async () => {
  const entry = entryAt("Offer");
  const offer = mint(entry.id);
  const res = await respondToOffer(offer.token!, "accept");
  assert.ok(res.ok && res.status === "accepted");
  assert.deepEqual(deliveries(entry.id).sort(), ["candidate.hired", "offer.accepted"]);
});

// ── finding 4: a (SIM) offer is not hire-bearing ─────────────────────────────

const SIM_TITLE = "Finalize Role (SIM)";
const hiresUsed = (): number => billingOverview(new Date()).meters.find((m) => m.meter === "hires")?.used ?? -1;

test("a (SIM) accept advances the entry but debits no hire and dispatches no ATS event", async () => {
  const entry = entryAt("Offer", SIM_TITLE);
  const offer = mint(entry.id, SIM_TITLE);
  const before = hiresUsed();

  const res = await respondToOffer(offer.token!, "accept");
  assert.ok(res.ok && res.status === "accepted");
  assert.equal(getPipelineEntry(entry.id)!.stage, "Hired", "the guided sim still reaches Hired");
  assert.equal(hiresUsed(), before, "no hire debited for demo residue");
  assert.deepEqual(deliveries(entry.id), [], "neither candidate.hired nor offer.accepted");
});

test("a (SIM) decline closes the entry but dispatches no offer.declined", async () => {
  const entry = entryAt("Offer", SIM_TITLE);
  const offer = mint(entry.id, SIM_TITLE);
  const res = await respondToOffer(offer.token!, "decline");
  assert.ok(res.ok && res.status === "declined");
  assert.equal(getPipelineEntry(entry.id)!.status, "declined");
  assert.deepEqual(deliveries(entry.id), []);
});

test("a real accept still debits exactly one hire (control)", async () => {
  const entry = entryAt("Offer");
  const offer = mint(entry.id);
  const before = hiresUsed();
  await respondToOffer(offer.token!, "accept");
  assert.equal(hiresUsed(), before + 1);
});
