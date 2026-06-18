// Pins the money-state machine: Polar payload normalization (mapPolarEvent) +
// the pure reducer that decides what a verified webhook does to our state.
// Subscription events carry entitlement; order events grant ONLY pack credits
// (plan charges/renewals also emit orders and must be ignored); ended statuses
// drop to free; unknown anything is ignored, never guessed.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// polar.ts imports its siblings extensionless ("./plans"), which the bare
// runner can't resolve — install the repo's minimal resolve hook (see
// rematch-source.test.ts) before importing the modules under test.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if ((spec.startsWith("./") || spec.startsWith("../")) && context.parentURL) {
      spec = new URL(spec, context.parentURL).href;
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts";
    }
    return nextResolve(spec, context);
  },
});

const { mapPolarEvent } = await import("./polar.ts");
const { reduceBillingEvent, subscriptionWriteIsStale } = await import("./reduce.ts");
import type { ProductMap } from "./gateway.ts";

const PRODUCTS: ProductMap = {
  prod_starter: { kind: "plan", plan: "starter" },
  prod_growth: { kind: "plan", plan: "growth" },
  prod_pack: { kind: "pack", meter: "interview_minutes", qty: 100 },
};

function subscriptionEvent(status: string, productId = "prod_starter") {
  return mapPolarEvent("evt_sub", {
    type: `subscription.${status === "active" ? "active" : "updated"}`,
    data: {
      id: "sub_1",
      status,
      product_id: productId,
      customer_id: "cus_1",
      current_period_start: "2026-06-01T00:00:00Z",
      current_period_end: "2026-07-01T00:00:00Z",
    },
  });
}

test("an active subscription sets the mapped plan with ids and period", () => {
  const action = reduceBillingEvent(subscriptionEvent("active"), PRODUCTS);
  assert.deepEqual(action, {
    kind: "set_subscription",
    plan: "starter",
    status: "active",
    customerId: "cus_1",
    subscriptionId: "sub_1",
    periodStart: "2026-06-01T00:00:00Z",
    periodEnd: "2026-07-01T00:00:00Z",
  });
});

test("canceled keeps the plan with canceled status (entitled until period end)", () => {
  const action = reduceBillingEvent(subscriptionEvent("canceled"), PRODUCTS);
  assert.equal(action.kind, "set_subscription");
  assert.equal((action as { status: string }).status, "canceled");
});

test("revoked clears to free", () => {
  const action = reduceBillingEvent(subscriptionEvent("revoked"), PRODUCTS);
  assert.deepEqual(action, { kind: "clear_subscription", customerId: "cus_1" });
});

test("an incomplete checkout entitles nothing", () => {
  assert.equal(reduceBillingEvent(subscriptionEvent("incomplete"), PRODUCTS).kind, "ignore");
});

test("a subscription for an unmapped product is ignored, not guessed", () => {
  assert.equal(reduceBillingEvent(subscriptionEvent("active", "prod_unknown"), PRODUCTS).kind, "ignore");
});

test("a PAID pack order grants credits deduped on the ORDER id", () => {
  const event = mapPolarEvent("evt_order", {
    type: "order.paid",
    data: { id: "order_77", product_id: "prod_pack", customer_id: "cus_1" },
  });
  const action = reduceBillingEvent(event, PRODUCTS);
  assert.deepEqual(action, {
    kind: "grant_credits",
    meter: "interview_minutes",
    qty: 100,
    providerRef: "order_77",
    reason: "pack purchase (order.paid)",
  });
});

test("an unpaid pack order (order.created) grants nothing yet", () => {
  const event = mapPolarEvent("evt_order0", {
    type: "order.created",
    data: { id: "order_77", product_id: "prod_pack" },
  });
  assert.equal(reduceBillingEvent(event, PRODUCTS).kind, "ignore");
});

test("a plan order (initial charge / renewal) grants nothing", () => {
  const event = mapPolarEvent("evt_order2", {
    type: "order.created",
    data: { id: "order_78", product_id: "prod_starter" },
  });
  assert.equal(reduceBillingEvent(event, PRODUCTS).kind, "ignore");
});

test("unknown event types are ignored", () => {
  const event = mapPolarEvent("evt_x", { type: "benefit_grant.created", data: { id: "bg_1" } });
  assert.equal(event.kind, "other");
  assert.equal(reduceBillingEvent(event, PRODUCTS).kind, "ignore");
});

test("mapPolarEvent reads nested product/customer objects as fallbacks", () => {
  const event = mapPolarEvent("evt_n", {
    type: "subscription.updated",
    data: { id: "sub_9", status: "active", product: { id: "prod_growth" }, customer: { id: "cus_9" } },
  });
  assert.equal(event.productId, "prod_growth");
  assert.equal(event.customerId, "cus_9");
  const action = reduceBillingEvent(event, PRODUCTS);
  assert.equal(action.kind, "set_subscription");
  assert.equal((action as { plan: string }).plan, "growth");
});

test("an unmapped subscription product is flagged unmapped (loud signal, not benign)", () => {
  // POLAR_PRODUCT_* env drift: a real paying subscription whose product id isn't
  // configured must NOT be silently ignored — the apply step logs it loudly.
  const event = subscriptionEvent("active", "prod_not_configured");
  const action = reduceBillingEvent(event, PRODUCTS);
  assert.equal(action.kind, "ignore");
  assert.equal((action as { unmapped?: boolean }).unmapped, true);
});

test("a mapped subscription is NOT flagged unmapped", () => {
  const action = reduceBillingEvent(subscriptionEvent("active", "prod_starter"), PRODUCTS);
  assert.equal(action.kind, "set_subscription");
});

test("subscriptionWriteIsStale: same subscription with an older period is stale", () => {
  const T2 = "2026-06-10T00:00:00.000Z";
  const T1 = "2026-05-10T00:00:00.000Z";
  // Same subscription, older incoming period -> stale (would regress).
  assert.equal(subscriptionWriteIsStale("sub_1", T2, "sub_1", T1), true);
  // Newer incoming period -> not stale.
  assert.equal(subscriptionWriteIsStale("sub_1", T1, "sub_1", T2), false);
  // Equal period -> apply (status may change within the period).
  assert.equal(subscriptionWriteIsStale("sub_1", T2, "sub_1", T2), false);
  // Different subscription (re-subscribe) -> always apply.
  assert.equal(subscriptionWriteIsStale("sub_1", T2, "sub_2", T1), false);
  // Missing anchors / no prior -> apply.
  assert.equal(subscriptionWriteIsStale(null, null, "sub_1", T1), false);
  assert.equal(subscriptionWriteIsStale("sub_1", T2, "sub_1", null), false);
});
