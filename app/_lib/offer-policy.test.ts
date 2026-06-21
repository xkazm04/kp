import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isOfferExpired,
  isOfferReminderDue,
  offerExpiresAtMs,
  offerHoursRemaining,
  OFFER_REMINDER_LEAD_MS,
  OFFER_TTL_MS,
} from "./offer-policy.ts";

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

test("isOfferReminderDue: inside T-48h true, beyond false, inclusive at the lead, exclusive at now", () => {
  const hours = (h: number) => new Date(NOW + h * 3600_000).toISOString();
  assert.equal(isOfferReminderDue(hours(24), NOW), true);
  assert.equal(isOfferReminderDue(hours(1), NOW), true);
  assert.equal(isOfferReminderDue(hours(72), NOW), false);
  assert.equal(isOfferReminderDue(hours(49), NOW), false);
  // Inclusive at exactly the lead time; a deadline AT now (or past) is lapsable, not remindable.
  assert.equal(isOfferReminderDue(new Date(NOW + OFFER_REMINDER_LEAD_MS).toISOString(), NOW), true);
  assert.equal(isOfferReminderDue(new Date(NOW).toISOString(), NOW), false);
  assert.equal(isOfferReminderDue(hours(-1), NOW), false);
  // A missing/invalid deadline never reminds (never-expires / fail-open).
  assert.equal(isOfferReminderDue(null, NOW), false);
  assert.equal(isOfferReminderDue("not-a-date", NOW), false);
});
