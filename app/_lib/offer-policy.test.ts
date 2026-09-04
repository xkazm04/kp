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
  validateOfferTerms,
  isOfferCurrency,
  OFFER_CURRENCIES,
  OFFER_SALARY_MAX,
  OFFER_NOTES_MAX_CHARS,
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

// --- Offer TERMS validation -------------------------------------------------

test("validateOfferTerms accepts unpriced terms — a missing figure is legal", () => {
  // draft_offer refuses to invent a number when the band is unknown; the auto-extend
  // gate parks that draft for a human. Unpriced must pass, not refuse.
  assert.deepEqual(validateOfferTerms({}), { ok: true, salary: null, currency: null, notes: null });
  assert.deepEqual(validateOfferTerms({ salary: null, currency: null }), {
    ok: true,
    salary: null,
    currency: null,
    notes: null,
  });
  // 0 has always meant "no figure" on this path (`Number(x) || null`).
  const zero = validateOfferTerms({ salary: 0 });
  assert.equal(zero.ok && zero.salary, null);
  // An unparseable value stays unpriced rather than refusing an otherwise fine offer.
  assert.deepEqual(validateOfferTerms({ salary: "about 120k" }), { ok: true, salary: null, currency: null, notes: null });
});

test("validateOfferTerms refuses a negative or absurd figure — the bug this closes", () => {
  // Was: `Number(draft.recommended) || null` — -5000 reached the candidate's accept
  // card verbatim as the salary they were being asked to agree to.
  const negative = validateOfferTerms({ salary: -5000, currency: "CZK" });
  assert.equal(negative.ok, false);
  assert.equal(negative.ok === false && negative.code, "OFFER_SALARY_INVALID");
  const absurd = validateOfferTerms({ salary: OFFER_SALARY_MAX + 1 });
  assert.equal(absurd.ok === false && absurd.code, "OFFER_SALARY_INVALID");
  assert.equal(absurd.ok === false && absurd.max, OFFER_SALARY_MAX);
  // The ceiling itself is inside the band, and a fractional figure floors to a whole unit.
  const ceiling = validateOfferTerms({ salary: OFFER_SALARY_MAX });
  assert.equal(ceiling.ok && ceiling.salary, OFFER_SALARY_MAX);
  const fractional = validateOfferTerms({ salary: 75_000.9 });
  assert.equal(fractional.ok && fractional.salary, 75_000);
});

test("validateOfferTerms normalizes a known currency and refuses one off the list", () => {
  const padded = validateOfferTerms({ salary: 75_000, currency: " czk " });
  assert.equal(padded.ok && padded.currency, "CZK");
  for (const code of OFFER_CURRENCIES) {
    assert.ok(validateOfferTerms({ currency: code }).ok, `${code} is on the closed list and must pass`);
  }
  // Was: `typeof draft.currency === "string"` — any sentence became the unit label.
  const arbitrary = validateOfferTerms({ currency: "bitcoin, negotiable" });
  assert.equal(arbitrary.ok === false && arbitrary.code, "OFFER_CURRENCY_UNSUPPORTED");
  // A non-string that is not empty means the draft carried SOMETHING as a currency.
  assert.equal(validateOfferTerms({ currency: 42 }).ok, false);
  // …but an absent/empty currency is the unit-less offer P2-1 deliberately allows.
  const empty = validateOfferTerms({ currency: "" });
  assert.equal(empty.ok && empty.currency, null);
  assert.ok(isOfferCurrency("EUR") && !isOfferCurrency("XXX"));
});

test("validateOfferTerms caps the free-text note", () => {
  const fine = validateOfferTerms({ notes: "  Signing bonus paid after probation.  " });
  assert.equal(fine.ok && fine.notes, "Signing bonus paid after probation.");
  const blank = validateOfferTerms({ notes: "   " });
  assert.equal(blank.ok && blank.notes, null);
  const long = validateOfferTerms({ notes: "x".repeat(OFFER_NOTES_MAX_CHARS + 1) });
  assert.equal(long.ok === false && long.code, "OFFER_NOTES_TOO_LONG");
  assert.equal(long.ok === false && long.max, OFFER_NOTES_MAX_CHARS);
  assert.ok(validateOfferTerms({ notes: "x".repeat(OFFER_NOTES_MAX_CHARS) }).ok);
});

test("the deadline is ELAPSED time across a DST boundary, and the module says so", () => {
  // Europe/Prague springs forward 2026-03-29 02:00 -> 03:00. An offer minted at
  // 14:00 local on 2026-03-26 with a 7-day window lapses SEVEN 24-HOUR DAYS later,
  // which is 15:00 local — one hour off the wall clock it was minted at. That is
  // the documented choice (duration is the promise; the row carries no timezone),
  // so pin BOTH halves: exact elapsed ms, and the wall-clock shift it implies.
  const mint = Date.parse("2026-03-26T13:00:00.000Z"); // 14:00 Europe/Prague (CET, UTC+1)
  const expires = offerExpiresAtMs(mint, 7);
  assert.equal(expires - mint, 7 * DAY, "seven days must be seven 24-hour days of elapsed time");

  const localHour = (ms: number) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", hour: "2-digit", hour12: false }).format(new Date(ms));
  assert.equal(localHour(mint), "14");
  assert.equal(localHour(expires), "15", "the wall clock shifts by an hour across spring-forward — by design");

  // And the same in the other direction (fall-back 2026-10-25), so the shift is
  // pinned as a property of elapsed time rather than of one transition.
  const autumnMint = Date.parse("2026-10-22T12:00:00.000Z"); // 14:00 Prague (CEST, UTC+2)
  const autumnExpires = offerExpiresAtMs(autumnMint, 7);
  assert.equal(autumnExpires - autumnMint, 7 * DAY);
  assert.equal(localHour(autumnMint), "14");
  assert.equal(localHour(autumnExpires), "13");

  // The countdown the candidate sees is computed from the same instant, so it can
  // never disagree with the deadline the letter states.
  assert.equal(offerHoursRemaining(new Date(expires).toISOString(), expires - 90 * 60 * 1000), 2);
});
