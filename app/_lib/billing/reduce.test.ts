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
const { reduceBillingEvent, subscriptionWriteIsStale, clearSubscriptionIsStale, setForRevokedSubscriptionIsStale } =
  await import("./reduce.ts");
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

test("revoked clears to free and carries the revoked subscription id", () => {
  const action = reduceBillingEvent(subscriptionEvent("revoked"), PRODUCTS);
  assert.deepEqual(action, { kind: "clear_subscription", customerId: "cus_1", subscriptionId: "sub_1" });
});

test("clearSubscriptionIsStale: a revoke for a DIFFERENT subscription than stored is stale", () => {
  // Customer churned sub_1, re-subscribed to sub_2 (now stored). A delayed revoke
  // for sub_1 must NOT wipe the live sub_2 to free.
  assert.equal(clearSubscriptionIsStale("sub_2", "sub_1"), true);
  // A genuine revoke of the currently-stored subscription DOES clear.
  assert.equal(clearSubscriptionIsStale("sub_1", "sub_1"), false);
  // Unknown ids can't prove staleness — don't skip (a real revoke must drop entitlement).
  assert.equal(clearSubscriptionIsStale(null, "sub_1"), false);
  assert.equal(clearSubscriptionIsStale("sub_2", null), false);
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

test("a REFUNDED pack order claws the credits back (idempotent negative grant, distinct ref)", () => {
  // Finding #1: a refund/dispute is the inverse of order.paid — it must DEBIT, not
  // collapse into the benign not-paid-yet ignore that left the 100 minutes in place.
  const event = mapPolarEvent("evt_refund", {
    type: "order.refunded",
    data: { id: "order_77", product_id: "prod_pack", customer_id: "cus_1" },
  });
  assert.deepEqual(reduceBillingEvent(event, PRODUCTS), {
    kind: "grant_credits",
    meter: "interview_minutes",
    qty: -100,
    // distinct from the grant's "order_77" so grant and reversal both dedupe once
    providerRef: "order_77:refund",
    reason: "pack refund (order.refunded)",
  });
  // order.canceled on a pack reverses too (dispute-loss / cancellation).
  const canceled = mapPolarEvent("evt_c", {
    type: "order.canceled",
    data: { id: "order_88", product_id: "prod_pack" },
  });
  const action = reduceBillingEvent(canceled, PRODUCTS);
  assert.equal(action.kind, "grant_credits");
  assert.equal((action as { qty: number }).qty, -100);
  assert.equal((action as { providerRef: string }).providerRef, "order_88:refund");
});

test("a multi-unit pack order grants pack.qty × quantity (and the refund claws the same back)", () => {
  // Finding #4: mapPolarEvent now reads data.quantity; the grant multiplies the fixed
  // pack size by it. A quantity:3 order the customer PAID 3× for must credit 300, not
  // the hardcoded 100 (pre-fix under-delivered a multi-unit checkout).
  const paid = mapPolarEvent("evt_q", {
    type: "order.paid",
    data: { id: "order_q", product_id: "prod_pack", customer_id: "cus_1", quantity: 3 },
  });
  assert.equal(paid.quantity, 3);
  assert.deepEqual(reduceBillingEvent(paid, PRODUCTS), {
    kind: "grant_credits",
    meter: "interview_minutes",
    qty: 300,
    providerRef: "order_q",
    reason: "pack purchase (order.paid)",
  });
  // The refund of that same multi-unit order reverses the FULL granted total (-300),
  // keeping grant and claw-back symmetric.
  const refund = mapPolarEvent("evt_qr", {
    type: "order.refunded",
    data: { id: "order_q", product_id: "prod_pack", quantity: 3 },
  });
  assert.equal((reduceBillingEvent(refund, PRODUCTS) as { qty: number }).qty, -300);
  // A missing/absent quantity defaults to 1 (single pack), and a malformed value too.
  const noQty = mapPolarEvent("evt_q0", { type: "order.paid", data: { id: "order_z", product_id: "prod_pack" } });
  assert.equal(noQty.quantity, 1);
  assert.equal((reduceBillingEvent(noQty, PRODUCTS) as { qty: number }).qty, 100);
  const badQty = mapPolarEvent("evt_q1", {
    type: "order.paid",
    data: { id: "order_b", product_id: "prod_pack", quantity: "not-a-number" },
  });
  assert.equal(badQty.quantity, 1);
});

test("a refund on a NON-pack (plan) order still grants nothing (subscription events carry that)", () => {
  const event = mapPolarEvent("evt_pr", {
    type: "order.refunded",
    data: { id: "order_99", product_id: "prod_starter" },
  });
  const action = reduceBillingEvent(event, PRODUCTS);
  assert.equal(action.kind, "ignore");
  // A MAPPED plan order is bookkeeping — benign, no alert.
  assert.equal((action as { unmapped?: boolean }).unmapped, undefined);
});

test("a PAID order for an unmapped product is flagged unmapped, not silently ignored", () => {
  // The order-side twin of the unmapped-subscription signal: the customer settled
  // money for a product id that isn't in the map at all, so we granted nothing and —
  // before this — logged nothing either, because it fell into the same benign
  // `ignore` as a plan renewal. applyBillingAction's unmapped arm turns this into a
  // console.error + a durable billing_alerts row.
  const paid = mapPolarEvent("evt_up", {
    type: "order.paid",
    data: { id: "order_dark", product_id: "prod_not_configured", customer_id: "cus_1" },
  });
  const action = reduceBillingEvent(paid, PRODUCTS);
  assert.equal(action.kind, "ignore");
  assert.equal((action as { unmapped?: boolean }).unmapped, true);
  // Stable per ORDER so redeliveries / the later refund collapse to ONE open alert.
  assert.equal((action as { providerRef?: string }).providerRef, "unmapped:order_dark");

  // A refund of that same dark order is settled money too — same flag, same ref.
  const refunded = mapPolarEvent("evt_ur", {
    type: "order.refunded",
    data: { id: "order_dark", product_id: "prod_not_configured" },
  });
  const refundAction = reduceBillingEvent(refunded, PRODUCTS);
  assert.equal((refundAction as { unmapped?: boolean }).unmapped, true);
  assert.equal((refundAction as { providerRef?: string }).providerRef, "unmapped:order_dark");

  // No order id at all → fall back to the product id (still stable per misconfig).
  const noOrderId = mapPolarEvent("evt_un", {
    type: "order.paid",
    data: { product_id: "prod_not_configured" },
  });
  assert.equal((reduceBillingEvent(noOrderId, PRODUCTS) as { providerRef?: string }).providerRef, "unmapped:prod_not_configured");
});

test("UNSETTLED chatter for an unmapped product stays a silent ignore (nothing was paid)", () => {
  // order.created fires before capture — an unknown product there is noise, not a
  // dark charge. Alerting on it would bury the real signal above.
  const created = mapPolarEvent("evt_uc", {
    type: "order.created",
    data: { id: "order_dark2", product_id: "prod_not_configured" },
  });
  const action = reduceBillingEvent(created, PRODUCTS);
  assert.equal(action.kind, "ignore");
  assert.equal((action as { unmapped?: boolean }).unmapped, undefined);
});

test("an unpaid subscription downgrades entitlement — not a silent no-op", () => {
  // Finding #2: `unpaid` (dunning exhausted) must be STORED so entitlement can bound
  // it, not fall through to `ignore` that leaves a stale active/past_due row entitled.
  const action = reduceBillingEvent(subscriptionEvent("unpaid"), PRODUCTS);
  assert.equal(action.kind, "set_subscription");
  assert.equal((action as { status: string }).status, "unpaid");
});

test("setForRevokedSubscriptionIsStale: a reordered set for an already-cleared sub is stale", () => {
  // Finding #3: after a revoke, the sub id is kept as a tombstone on a `free` row; a
  // delayed pre-revoke `active` for that same id must NOT re-entitle.
  assert.equal(setForRevokedSubscriptionIsStale("free", "sub_1", "sub_1"), true);
  // A live subscription (non-free stored plan) takes normal updates.
  assert.equal(setForRevokedSubscriptionIsStale("starter", "sub_1", "sub_1"), false);
  // A genuine re-subscribe arrives under a NEW id — let it through.
  assert.equal(setForRevokedSubscriptionIsStale("free", "sub_1", "sub_2"), false);
  // No tombstone / no incoming id — can't prove staleness.
  assert.equal(setForRevokedSubscriptionIsStale("free", null, "sub_1"), false);
  assert.equal(setForRevokedSubscriptionIsStale("free", "sub_1", null), false);
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

test("an unmapped subscription carries a stable providerRef so repeated alerts dedupe (finding #5)", () => {
  // The alert dedupe key must be STABLE across repeated distinct subscription.updated
  // deliveries for the same dark subscription — otherwise each fresh event id piles up
  // a new open billing_alerts row. The subscription id (else its product) is that key.
  const bySub = reduceBillingEvent(subscriptionEvent("active", "prod_not_configured"), PRODUCTS);
  assert.equal((bySub as { providerRef?: string }).providerRef, "unmapped:sub_1");
  // With no subscription id, fall back to the product id (still stable per misconfig).
  const noSub = mapPolarEvent("evt_np", {
    type: "subscription.updated",
    data: { status: "active", product_id: "prod_not_configured", customer_id: "cus_1" },
  });
  assert.equal((reduceBillingEvent(noSub, PRODUCTS) as { providerRef?: string }).providerRef, "unmapped:prod_not_configured");
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
