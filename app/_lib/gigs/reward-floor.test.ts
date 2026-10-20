// The reward rules (gigs/reward-floor.ts) over the shapes the adapters really write
// (freelancer.ts: "$30-$250 USD", "₹600-₹1,500 INR", "$2-$8/hr USD"; upwork.ts: "15-30/hr USD").
// Proves: the ceiling is the TOP of the range, not `amount`; a converted reward uses the
// scan's own rate and an unconverted one the table's; a currency with no rate is kept (never
// guessed); the floors bind freelance only; no stated reward goes in every arena.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FxTable } from "./fx.ts";
import {
  exclusionNeedsFx,
  gigExclusion,
  GIG_FIXED_FLOOR_USD,
  GIG_HOURLY_FLOOR_USD,
  hasStatedReward,
  isGigPurgeRule,
  isHourlyReward,
  purgeRuleOf,
  rewardCeiling,
  rewardCeilingUsd,
} from "./reward-floor.ts";
import type { GigReward } from "./types.ts";

const TABLE: FxTable = {
  rates: { INR: { rate: 95.92, date: "2026-09-30" }, EUR: { rate: 0.88, date: "2026-09-30" }, GBP: { rate: 0.75, date: null }, NZD: { rate: 1.7, date: null } },
  fetchedAt: "2026-09-30T07:00:00.000Z",
  source: "test",
};
const r = (text: string, amount: number | null, currency: string | null): GigReward => ({ amount, currency, text });
const fl = (reward: GigReward | null) => ({ arena: "freelance" as const, reward });

test("the floors are the operator's numbers", () => {
  assert.equal(GIG_FIXED_FLOOR_USD, 50);
  assert.equal(GIG_HOURLY_FLOOR_USD, 10);
});

test("the ceiling is the largest stated figure: ranges, single amounts, commas, k", () => {
  assert.equal(rewardCeiling(r("$30-$250 USD", 30, "USD")), 250, "the TOP of the range, not `amount`");
  assert.equal(rewardCeiling(r("$5,000-$10,000 USD", 5000, "USD")), 10000);
  assert.equal(rewardCeiling(r("50 USD", 50, "USD")), 50);
  assert.equal(rewardCeiling(r("$2k bounty", 2000, "USD")), 2000);
  assert.equal(rewardCeiling(r("1,500.00-3,000.00 EUR", 1500, "EUR")), 3000);
  assert.equal(rewardCeiling(r("Swag", null, null)), null, "no figure");
  assert.equal(rewardCeiling(r("see listing", 40, "USD")), 40, "`amount` when the text has no number");
});

test("USD, pegged coins, a stored scan rate, the table's rate; an unknown currency has no ceiling", () => {
  assert.equal(rewardCeilingUsd(r("$30-$250 USD", 30, "USD")), 250);
  assert.equal(rewardCeilingUsd(r("2.00 USDC", 2, "USDC")), 2);
  assert.equal(rewardCeilingUsd(r("₹600-₹1,500 INR", 600, "INR"), TABLE), 15.64);
  const stored: GigReward = { ...r("₹600-₹1,500 INR", 600, "INR"), usd: { amount: 6, rate: 100, rateAt: "2026-09-29", source: "x" } };
  assert.equal(rewardCeilingUsd(stored, TABLE), 15, "the scan's own rate wins over the table");
  assert.equal(rewardCeilingUsd(r("€30-€250 EUR", 30, "EUR"), TABLE), 284.09);
  assert.equal(rewardCeilingUsd(r("₹600-₹1,500 INR", 600, "INR"), null), null, "no table, no rate: no ceiling");
  assert.equal(rewardCeilingUsd(r("100-200 XYZ", 100, "XYZ"), TABLE), null, "a currency the table lacks");
  assert.equal(rewardCeilingUsd(r("$200", 200, null), TABLE), null, "no currency is never assumed to be USD");
});

test("hourly is the adapters' own marker", () => {
  assert.equal(isHourlyReward(r("$2-$8/hr USD", 2, "USD")), true);
  assert.equal(isHourlyReward(r("15-30/hr USD", 15, "USD")), true, "upwork.ts");
  assert.equal(isHourlyReward(r("$20 per hour", 20, "USD")), true);
  assert.equal(isHourlyReward(r("$30-$250 USD", 30, "USD")), false);
});

test("the operator's examples: $30-$250 stays; $10-$30, INR 600-1,500 and $2-$8/hr go", () => {
  assert.equal(gigExclusion(fl(r("$30-$250 USD", 30, "USD")), TABLE), null);
  assert.equal(gigExclusion(fl(r("$10-$30 USD", 10, "USD")), TABLE), "below_floor_fixed");
  assert.equal(gigExclusion(fl(r("₹600-₹1,500 INR", 600, "INR")), TABLE), "below_floor_fixed");
  assert.equal(gigExclusion(fl(r("$2-$8/hr USD", 2, "USD")), TABLE), "below_floor_hourly");
  assert.equal(gigExclusion(fl(r("$3-$10/hr NZD", 3, "NZD")), TABLE), "below_floor_hourly", "converted hourly");
  assert.equal(gigExclusion(fl(r("£10-£20 GBP", 10, "GBP")), TABLE), "below_floor_fixed", "£20 is $26.67");
});

test("the floor boundaries: $50 fixed and $10/hr stay", () => {
  assert.equal(gigExclusion(fl(r("$30-$50 USD", 30, "USD"))), null);
  assert.equal(gigExclusion(fl(r("$49.99 USD", 49.99, "USD"))), "below_floor_fixed");
  assert.equal(gigExclusion(fl(r("$6-$10/hr USD", 6, "USD"))), null);
  assert.equal(gigExclusion(fl(r("$25-$50/hr USD", 25, "USD"))), null, "a $50/hr rate is not a $50 job");
});

test("a rate kp does not know keeps the gig; so does a reward with words and no figure", () => {
  assert.equal(gigExclusion(fl(r("₹600-₹1,500 INR", 600, "INR")), null), null);
  assert.equal(gigExclusion(fl(r("Paid in exposure", null, null))), null);
});

test("no stated reward goes in every arena; the floors bind freelance only", () => {
  for (const arena of ["freelance", "oss_bounty", "security", "competition"] as const) {
    assert.equal(gigExclusion({ arena, reward: null }), "no_reward", arena);
    assert.equal(gigExclusion({ arena, reward: r("   ", null, null) }), "no_reward", `${arena}: blank text`);
  }
  assert.equal(gigExclusion({ arena: "oss_bounty", reward: r("0.99 USDC", 0.99, "USDC") }), null, "a small bounty is not a freelance job");
  assert.equal(gigExclusion({ arena: "competition", reward: r("Knowledge", null, null) }), null, "a non-monetary reward is stated");
  assert.equal(hasStatedReward(null), false);
});

test("the fx need, the purge rule names", () => {
  assert.equal(exclusionNeedsFx(fl(r("₹600-₹1,500 INR", 600, "INR"))), true);
  assert.equal(exclusionNeedsFx(fl(r("$10-$30 USD", 10, "USD"))), false);
  assert.equal(exclusionNeedsFx({ arena: "oss_bounty", reward: r("€100", 100, "EUR") }), false);
  assert.equal(purgeRuleOf("below_floor_hourly"), "below_floor");
  assert.equal(purgeRuleOf("no_reward"), "no_reward");
  assert.equal(isGigPurgeRule("below_floor"), true);
  assert.equal(isGigPurgeRule("below_floor_fixed"), false);
});
