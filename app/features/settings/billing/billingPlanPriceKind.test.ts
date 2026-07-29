import { test } from "node:test";
import assert from "node:assert/strict";
import { planPriceKind } from "./billingPlanPriceKind.ts";
import { PLANS } from "../../../_lib/billing/plans.ts";

// bug-ui-scan-2026-07-09 (plans-checkout-billing-ui #5): the current-plan header
// priced Enterprise as "Free" because it checked priceCzk===0 instead of contactSales.
// contactSales MUST win over the 0 sentinel.

test("Enterprise (contactSales, priceCzk 0 sentinel) → custom, NOT free", () => {
  // This is the exact regression: a naive priceCzk===0 check would return "free" here.
  assert.deepEqual(planPriceKind(PLANS.enterprise), { kind: "custom" });
  assert.notEqual(planPriceKind(PLANS.enterprise).kind, "free");
});

test("Free tier → free", () => {
  assert.deepEqual(planPriceKind(PLANS.free), { kind: "free" });
});

test("paid tiers carry both the CZK charge and the approx USD", () => {
  assert.deepEqual(planPriceKind(PLANS.starter), { kind: "paid", czk: 240, usdApprox: 10 });
  assert.deepEqual(planPriceKind(PLANS.growth), { kind: "paid", czk: 480, usdApprox: 20 });
  assert.deepEqual(planPriceKind(PLANS.byom), { kind: "paid", czk: 120, usdApprox: 5 });
});

test("contactSales wins even if a future custom tier had a non-zero placeholder price", () => {
  assert.deepEqual(planPriceKind({ contactSales: true, priceCzk: 9999, priceUsdApprox: 9999 }), {
    kind: "custom",
  });
});
