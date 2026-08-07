// getAtsRecord must carry the offer that actually caused the hire, not the oldest
// on file (ats-integration-egress #1). At candidate.hired time the accepted offer
// is no longer status 'extended', so getOpenOfferForEntry returns null; the old
// fallback listOffersForEntry(entryId)[0] (created_at ASC) shipped the OLDEST
// offer — wrong comp AND a contradictory 'declined' status inside a hired event on
// any re-extended entry. (testing/unit-db.ts must be the first project import.)
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPipelineEntry } from "./db/pipeline.ts";
import { createOffer, markOfferResponded } from "./offers-store.ts";
import { getAtsRecord } from "./ats-egress.ts";

after(() => cleanupUnitDb());

test("a re-extended entry's ATS record carries the ACCEPTED offer, not the oldest declined one", () => {
  const { entry } = createPipelineEntry({
    candidateId: "ats-reext", candidateLabel: "Reext Cand", jobId: "job-ats",
    jobTitle: "ATS Role", stage: "Offer", contact: "ats-reext@example.com",
  });
  // First offer: lower comp, later DECLINED.
  const first = createOffer({
    entryId: entry.id, candidateLabel: "Reext Cand", jobId: "job-ats", jobTitle: "ATS Role",
    currency: "USD", salary: 90000, payload: null,
  });
  markOfferResponded(first.token, "declined");
  // Second offer: higher comp, ACCEPTED — this is the hire.
  const second = createOffer({
    entryId: entry.id, candidateLabel: "Reext Cand", jobId: "job-ats", jobTitle: "ATS Role",
    currency: "USD", salary: 120000, payload: null,
  });
  markOfferResponded(second.token, "accepted");

  const record = getAtsRecord(entry.id)!;
  assert.ok(record.offer, "the record carries an offer");
  // Pre-fix: offer = oldest ⇒ amount 90000, status 'declined' inside a hired event.
  assert.equal(record.offer!.amount, 120000, "the record carries the ACCEPTED offer's amount");
  assert.equal(record.offer!.status, "accepted", "the record carries the accepted status, not the declined one");
});
