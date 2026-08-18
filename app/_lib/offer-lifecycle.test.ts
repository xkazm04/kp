// Behavioral coverage for the offer lifecycle — offers-store.ts +
// offer-finalize.ts + offer-reminders.ts — against an ISOLATED throwaway DB
// (testing/unit-db.ts must stay the first project import). Pins the terminal
// finalization paths (accept → Hired; decline → terminal status),
// the stale-link guards around them, deadline expiry, and the at-most-once
// reminder claim.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { cleanupUnitDb, UNIT_DB_PATH } from "./testing/unit-db.ts";
import { createPipelineEntry, getPipelineEntry, hasEvent } from "./db/pipeline.ts";
import {
  createOffer,
  dueOfferReminders,
  getOfferByToken,
  getOrCreateOpenOffer,
  lapseExpiredOffers,
  markOfferReminded,
} from "./offers-store.ts";
import { offerView, respondToOffer } from "./offer-finalize.ts";
import { sendDueOfferReminders } from "./offer-reminders.ts";

after(() => cleanupUnitDb());

let seq = 0;
function entryAtOffer() {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `offer-c${seq}`,
    candidateLabel: `Offer Candidate ${seq}`,
    jobId: `offer-job-${seq}`,
    jobTitle: "Offer Test Role",
    stage: "Offer",
    contact: `offer-c${seq}@example.com`,
  });
  return entry;
}

function mintOffer(entryId: string, ttlDays?: number) {
  return createOffer({
    entryId,
    candidateLabel: "Offer Candidate",
    jobId: null,
    jobTitle: "Offer Test Role",
    currency: "CZK",
    salary: 80_000,
    payload: { recommended: 80_000 },
    ttlDays: ttlDays ?? null,
  });
}

/** Force an offer's deadline into the past directly (own WAL connection on the
 *  same isolated file), simulating time passing without a clock hook. */
function forceExpiry(token: string): void {
  const d = new Database(UNIT_DB_PATH);
  try {
    d.pragma("busy_timeout = 5000");
    d.prepare(`UPDATE offers SET expires_at = ? WHERE token = ?`).run(new Date(Date.now() - 60_000).toISOString(), token);
  } finally {
    d.close();
  }
}

test("accept claims once: offer accepted, entry → Hired; a retry is a no-op echo", async () => {
  const entry = entryAtOffer();
  const offer = mintOffer(entry.id);

  const first = await respondToOffer(offer.token, "accept");
  assert.deepEqual(
    { ok: first.ok, status: first.ok ? first.status : null, already: first.ok ? first.alreadyResponded : null },
    { ok: true, status: "accepted", already: false }
  );
  assert.equal(getOfferByToken(offer.token)!.status, "accepted");
  const hired = getPipelineEntry(entry.id)!;
  assert.equal(hired.stage, "Hired");
  assert.equal(hired.status, "active", "Hired keeps status active by contract");
  assert.ok(hasEvent(entry.id, "offer_accepted"));

  // Idempotent second response (refresh / double-click): reports, mutates nothing.
  const retry = await respondToOffer(offer.token, "accept");
  assert.ok(retry.ok && retry.alreadyResponded);
  assert.equal(retry.ok ? retry.status : null, "accepted");
});

test("decline is terminal for the entry and audited", async () => {
  const entry = entryAtOffer();
  const offer = mintOffer(entry.id);

  const result = await respondToOffer(offer.token, "decline");
  assert.ok(result.ok && result.status === "declined" && !result.alreadyResponded);
  assert.equal(getOfferByToken(offer.token)!.status, "declined");
  const closed = getPipelineEntry(entry.id)!;
  assert.equal(closed.status, "declined", "candidate declines get their own terminal status, not 'rejected'");
  assert.ok(hasEvent(entry.id, "offer_declined"));
});

test("a stale decline on a duplicate link cannot demote a candidate who has since been Hired", async () => {
  const entry = entryAtOffer();
  const firstOffer = mintOffer(entry.id);
  await respondToOffer(firstOffer.token, "accept"); // → Hired

  // A second link can exist (re-extend after the first closed); declining it must
  // not overwrite the hire.
  const staleLink = mintOffer(entry.id);
  const result = await respondToOffer(staleLink.token, "decline");
  assert.ok(result.ok, "the offer row itself records the decline");
  const still = getPipelineEntry(entry.id)!;
  assert.equal(still.stage, "Hired");
  assert.equal(still.status, "active", "markEntryStatus must refuse to demote a Hired entry");
  assert.equal(hasEvent(entry.id, "offer_declined"), false, "no phantom decline on the hire's timeline");
});

test("a lapsed deadline makes the link dead: respond reports expired, the row flips, the lapse is audited", async () => {
  const entry = entryAtOffer();
  const offer = mintOffer(entry.id);
  forceExpiry(offer.token);

  const result = await respondToOffer(offer.token, "accept");
  // The refusal carries a CODE the candidate page localizes, not an English
  // sentence; `expired` is what the route reads to answer 410 rather than 404.
  assert.deepEqual(result, { ok: false, code: "OFFER_EXPIRED", expired: true });
  assert.equal(getOfferByToken(offer.token)!.status, "expired");
  assert.ok(hasEvent(entry.id, "offer_expired"));
  assert.equal(getPipelineEntry(entry.id)!.stage, "Offer", "an expired link must not move the entry");
  assert.equal(offerView(offer.token)!.status, "expired", "the candidate page sees the lapse immediately");

  // Unknown token stays a plain not-found.
  const missing = await respondToOffer("tk-does-not-exist", "accept");
  assert.deepEqual(missing, { ok: false, code: "OFFER_NOT_FOUND" });
});

test("lapseExpiredOffers sweeps every due open offer exactly once", () => {
  const entry = entryAtOffer();
  const offer = mintOffer(entry.id);
  forceExpiry(offer.token);
  assert.equal(lapseExpiredOffers(), 1);
  assert.equal(getOfferByToken(offer.token)!.status, "expired");
  assert.equal(lapseExpiredOffers(), 0, "a second sweep finds nothing to lapse");
});

test("reminder eligibility: only open offers inside the T-48h window, and the CAS claim fires at most once", () => {
  const soonEntry = entryAtOffer();
  const soon = mintOffer(soonEntry.id, 1); // expires in 24h → inside the 48h lead
  const farEntry = entryAtOffer();
  const far = mintOffer(farEntry.id, 30); // expires in 30d → not yet due

  const dueTokens = new Set(dueOfferReminders().map((o) => o.token));
  assert.ok(dueTokens.has(soon.token), "an offer inside the lead window is due");
  assert.ok(!dueTokens.has(far.token), "an offer far from its deadline is not due");

  // CAS: exactly one claimer wins; a claimed offer leaves the due set.
  assert.equal(markOfferReminded(soon.token), true);
  assert.equal(markOfferReminded(soon.token), false);
  assert.ok(!new Set(dueOfferReminders().map((o) => o.token)).has(soon.token));
});

test("sendDueOfferReminders dispatches each due offer once across sweeps", async () => {
  const entry = entryAtOffer();
  mintOffer(entry.id, 1); // due immediately (24h < 48h lead)
  const sent = await sendDueOfferReminders();
  assert.equal(sent, 1);
  assert.equal(await sendDueOfferReminders(), 0, "the claim persists — no duplicate nudge on the next tick");
});

test("offerView ships a SERVER-computed hoursRemaining so the countdown can't drift on a skewed client clock", () => {
  // bug-ui-scan-2026-07-09 (offers-onboarding #5): the candidate page must render the
  // hours-left from the server's clock, not Date.now() on an untrusted device.
  const entry = entryAtOffer();
  const offer = mintOffer(entry.id, 1); // 1-day TTL → ~24h out
  const view = offerView(offer.token)!;
  assert.equal(typeof view.hoursRemaining, "number", "the view must carry a server-side hours-left figure");
  assert.ok(view.hoursRemaining! >= 23 && view.hoursRemaining! <= 24, `expected ~24h, got ${view.hoursRemaining}`);
});

test("getOrCreateOpenOffer reuses the one open offer per entry instead of minting a second live link", () => {
  const entry = entryAtOffer();
  const input = {
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    currency: "CZK",
    salary: 90_000,
    payload: {},
  };
  const first = getOrCreateOpenOffer(input);
  const second = getOrCreateOpenOffer(input);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.offer.token, first.offer.token, "a re-extend re-sends the SAME link");
});
