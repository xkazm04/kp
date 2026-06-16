import { test } from "node:test";
import assert from "node:assert/strict";
import { isOfferExpired, offerExpiresAtMs, offerHoursRemaining, OFFER_TTL_MS } from "./offer-policy.ts";

const NOW = Date.parse("2026-06-13T12:00:00.000Z");

test("offerExpiresAtMs adds the TTL", () => {
  assert.equal(offerExpiresAtMs(NOW), NOW + OFFER_TTL_MS);
});

test("isOfferExpired: null/garbage fail-open, future open, past expired", () => {
  assert.equal(isOfferExpired(null, NOW), false);
  assert.equal(isOfferExpired(undefined, NOW), false);
  assert.equal(isOfferExpired("not-a-date", NOW), false);
  assert.equal(isOfferExpired(new Date(NOW + 3600_000).toISOString(), NOW), false);
  assert.equal(isOfferExpired(new Date(NOW - 1).toISOString(), NOW), true);
  // Exactly at the deadline counts as expired (>=).
  assert.equal(isOfferExpired(new Date(NOW).toISOString(), NOW), true);
});

test("offerHoursRemaining rounds up, floors at 0, null on no deadline", () => {
  assert.equal(offerHoursRemaining(null, NOW), null);
  assert.equal(offerHoursRemaining("bad", NOW), null);
  assert.equal(offerHoursRemaining(new Date(NOW + 90 * 60_000).toISOString(), NOW), 2); // 1.5h -> 2
  assert.equal(offerHoursRemaining(new Date(NOW + 24 * 3600_000).toISOString(), NOW), 24);
  assert.equal(offerHoursRemaining(new Date(NOW - 5 * 3600_000).toISOString(), NOW), 0);
});
