import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isOfferExpired,
  isOfferReminderDue,
  offerExpiresAtMs,
  offerHoursRemaining,
  resolveOfferTtlDays,
  resolveOfferTtlMs,
  OFFER_REMINDER_LEAD_MS,
  OFFER_TTL_MS,
  OFFER_TTL_DAYS_MIN,
  OFFER_TTL_DAYS_MAX,
} from "./offer-policy.ts";

const NOW = Date.parse("2026-06-13T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

test("offerExpiresAtMs adds the default TTL when no per-offer deadline is given", () => {
  assert.equal(offerExpiresAtMs(NOW), NOW + OFFER_TTL_MS);
});

test("resolveOfferTtlMs honors a valid per-offer deadline (the recruiter's lever)", () => {
  assert.equal(resolveOfferTtlMs(1), 1 * DAY); // tight exploding offer
  assert.equal(resolveOfferTtlMs(30), 30 * DAY); // exec search
  assert.equal(resolveOfferTtlMs(7.9), 7 * DAY); // floored to whole days
  assert.equal(offerExpiresAtMs(NOW, 3), NOW + 3 * DAY);
});

test("resolveOfferTtlMs falls back to the default for missing/out-of-range days", () => {
  assert.equal(resolveOfferTtlMs(null), OFFER_TTL_MS);
  assert.equal(resolveOfferTtlMs(undefined), OFFER_TTL_MS);
  assert.equal(resolveOfferTtlMs(0), OFFER_TTL_MS); // below min
  assert.equal(resolveOfferTtlMs(OFFER_TTL_DAYS_MAX + 1), OFFER_TTL_MS); // above max
  assert.equal(resolveOfferTtlMs(Number.NaN), OFFER_TTL_MS);
  assert.equal(resolveOfferTtlMs(OFFER_TTL_DAYS_MIN), OFFER_TTL_DAYS_MIN * DAY); // min is allowed
});

test("resolveOfferTtlDays reports the APPLIED whole-day window (what offers-store persists)", () => {
  // offers-store stores this figure and compares it across re-extends, so it must be
  // the value actually applied — a rejected request resolves to the deployment default,
  // never to the raw input.
  assert.equal(resolveOfferTtlDays(14), 14);
  assert.equal(resolveOfferTtlDays(7.9), 7);
  assert.equal(resolveOfferTtlDays(null), OFFER_TTL_MS / DAY);
  assert.equal(resolveOfferTtlDays(0), OFFER_TTL_MS / DAY); // below min
  assert.equal(resolveOfferTtlDays(OFFER_TTL_DAYS_MAX + 1), OFFER_TTL_MS / DAY); // above max
  assert.equal(resolveOfferTtlDays(14) * DAY, resolveOfferTtlMs(14), "days and ms stay one resolution");
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
