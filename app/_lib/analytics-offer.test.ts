import { test } from "node:test";
import assert from "node:assert/strict";
import { offerConversion, MIN_OFFERS } from "./analytics-offer.ts";

test("rates are over the extended denominator once the min-offers gate is cleared", () => {
  // 10 extended: 6 accepted, 2 declined, 1 expired, 1 still pending.
  const o = offerConversion({ extended: 10, accepted: 6, declined: 2, expired: 1 });
  assert.equal(o.enoughData, true);
  assert.equal(o.extended, 10);
  assert.equal(o.pending, 1);
  assert.equal(o.acceptRatePct, 60);
  assert.equal(o.declineRatePct, 20);
  assert.equal(o.expireRatePct, 10);
  assert.equal(o.acceptRate, 0.6);
  assert.equal(o.n, 10);
});

test("below the min-offers floor every rate is suppressed (null, not zero)", () => {
  const o = offerConversion({ extended: 3, accepted: 2, declined: 1, expired: 0 });
  assert.equal(o.enoughData, false);
  assert.equal(o.n, 3);
  assert.equal(o.minOffers, MIN_OFFERS);
  assert.equal(o.acceptRatePct, null);
  assert.equal(o.acceptRate, null);
  // The raw counts still pass through for a "K of MIN" gate line.
  assert.equal(o.accepted, 2);
  assert.equal(o.extended, 3);
});

test("a missing offer_sent trail can't push a rate past 100% (denominator floored at resolved)", () => {
  // 8 terminal events but only 5 offer_sent logged (legacy): denominator = 8.
  const o = offerConversion({ extended: 5, accepted: 8, declined: 0, expired: 0 });
  assert.equal(o.extended, 8);
  assert.equal(o.n, 8);
  assert.equal(o.pending, 0);
  assert.equal(o.acceptRatePct, 100);
});

test("no offers at all → gated, zeroed, no NaN", () => {
  const o = offerConversion({ extended: 0, accepted: 0, declined: 0, expired: 0 });
  assert.equal(o.enoughData, false);
  assert.equal(o.n, 0);
  assert.equal(o.acceptRatePct, null);
  assert.equal(o.acceptRate, null);
  assert.equal(o.pending, 0);
});

test("negative / non-finite counts are clamped to zero", () => {
  const o = offerConversion({ extended: Number.NaN, accepted: -3, declined: 2, expired: 0 });
  assert.equal(o.accepted, 0);
  assert.equal(o.declined, 2);
  assert.equal(o.extended, 2); // max(0, 0+2+0)
});
