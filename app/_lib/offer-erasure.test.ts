// Erasure closes the offer door: anonymizeEntry nulls the capability token of every offer
// row of the erased entry and closes a still-open one to 'expired', so the old link
// answers not-found instead of moving the entry to Hired, debiting the hire meter and
// mirroring candidate.hired. Isolated throwaway DB (testing/unit-db.ts stays first).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { anonymizeEntry, createPipelineEntry, getPipelineEntry, hasEvent } from "./db/pipeline.ts";
import {
  createOffer,
  dueOfferReminders,
  getOfferByToken,
  lapseExpiredOffers,
  listOffersForEntry,
  markOfferResponded,
} from "./offers-store.ts";
import { respondToOffer } from "./offer-finalize.ts";
import { billingOverview } from "./billing/entitlements.ts";

after(() => cleanupUnitDb());

let seq = 0;
function entryAtOffer(workspaceId?: string) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `oerase-c${seq}`,
    candidateLabel: `Erase Candidate ${seq}`,
    jobId: `oerase-job-${seq}`,
    jobTitle: "Erase Role",
    stage: "Offer",
    contact: `oerase-c${seq}@example.com`,
    ...(workspaceId ? { workspaceId } : {}),
  });
  return entry;
}

function mintOffer(entryId: string) {
  return createOffer({
    entryId,
    candidateLabel: "Erase Candidate",
    jobId: null,
    jobTitle: "Erase Role",
    currency: "CZK",
    salary: 80_000,
    payload: { recommended: 80_000 },
    ttlDays: 1,
  });
}

const hiresUsed = (): number => billingOverview(new Date()).meters.find((m) => m.meter === "hires")?.used ?? -1;

test("an erased candidate's open offer link is dead: not found, no hire, no meter debit", async () => {
  const entry = entryAtOffer();
  const offer = mintOffer(entry.id);
  const token = offer.token!;
  const before = getPipelineEntry(entry.id)!;
  const used = hiresUsed();

  assert.ok(anonymizeEntry(entry.id, "erasure"));

  assert.equal(getOfferByToken(token), null, "the old token resolves to nothing");
  const res = await respondToOffer(token, "accept");
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.code, "OFFER_NOT_FOUND");

  const after_ = getPipelineEntry(entry.id)!;
  assert.notEqual(after_.stage, "Hired");
  assert.equal(after_.stage, before.stage, "stage unchanged");
  assert.equal(after_.status, before.status, "status unchanged");
  assert.equal(hasEvent(entry.id, "offer_accepted"), false, "no acceptance on the timeline");
  assert.equal(hiresUsed(), used, "the hire meter is not debited");

  const [row] = listOffersForEntry(entry.id);
  assert.equal(row.token, null);
  assert.equal(row.status, "expired", "the open row is closed");
  assert.ok(new Date(row.expiresAt!).getTime() <= Date.now(), "no future-dated deadline survives");
  assert.equal(row.salary, 80_000, "salary stays as the retained record");
});

test("the expiry sweep and the reminder selection no longer see the erased entry's offer", () => {
  const entry = entryAtOffer();
  mintOffer(entry.id);
  anonymizeEntry(entry.id, "erasure");
  lapseExpiredOffers(Date.now() + 10 * 86_400_000);
  const far = 365 * 86_400_000;
  assert.equal(dueOfferReminders(Date.now(), far).some((o) => o.entryId === entry.id), false);
  assert.equal(hasEvent(entry.id, "offer_expired"), false, "no expiry event is minted for the erased row");
});

test("an offer accepted before the erasure also loses its token, and keeps its status", () => {
  const entry = entryAtOffer();
  const offer = mintOffer(entry.id);
  assert.equal(markOfferResponded(offer.token!, "accepted").claimed, true);
  anonymizeEntry(entry.id, "erasure");
  const [row] = listOffersForEntry(entry.id);
  assert.equal(row.token, null);
  assert.equal(row.status, "accepted");
});

test("another entry's offer is untouched, in this workspace and in another", async () => {
  const gone = entryAtOffer();
  mintOffer(gone.id);
  const sameWs = entryAtOffer();
  const sameOffer = mintOffer(sameWs.id);
  const otherWs = entryAtOffer("other-team");
  const otherOffer = mintOffer(otherWs.id);

  anonymizeEntry(gone.id, "erasure");

  for (const o of [sameOffer, otherOffer]) {
    const live = getOfferByToken(o.token!);
    assert.ok(live, "the neighbour's link still resolves");
    assert.equal(live.status, "extended");
    assert.equal(live.token, o.token);
  }
  const res = await respondToOffer(sameOffer.token!, "decline");
  assert.equal(res.ok, true, "the neighbour can still answer");
});
