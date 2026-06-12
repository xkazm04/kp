// Pure webhook reducer: a normalized BillingEvent + the product map → ONE
// BillingAction. No I/O here — the route verifies, the idempotency gate
// dedupes, this decides, sync.ts applies. Keeping it pure makes the whole
// money-state machine unit-testable without a DB or a provider.

import type { BillingEvent, ProductMap } from "./gateway";
import type { Meter, PlanId } from "./plans";

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled";

export type BillingAction =
  | {
      kind: "set_subscription";
      plan: PlanId;
      status: SubscriptionStatus;
      customerId: string | null;
      subscriptionId: string | null;
      periodStart: string | null;
      periodEnd: string | null;
    }
  | { kind: "clear_subscription"; customerId: string | null }
  | { kind: "grant_credits"; meter: Meter; qty: number; providerRef: string; reason: string }
  | { kind: "ignore"; reason: string };

// Provider statuses that mean "the subscription is gone, drop to free".
const ENDED_STATUSES = new Set(["revoked", "ended", "incomplete_expired", "expired"]);

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  canceled: "canceled", // cancel-at-period-end: stays entitled until periodEnd
  cancelled: "canceled",
};

export function reduceBillingEvent(event: BillingEvent, products: ProductMap): BillingAction {
  if (event.kind === "subscription") {
    const status = (event.status ?? "").toLowerCase();
    if (ENDED_STATUSES.has(status)) {
      return { kind: "clear_subscription", customerId: event.customerId };
    }
    const mapped = event.productId ? products[event.productId] : undefined;
    if (!mapped || mapped.kind !== "plan") {
      return { kind: "ignore", reason: `subscription event for unmapped product ${event.productId ?? "?"}` };
    }
    const normalized = STATUS_MAP[status];
    if (!normalized) {
      // e.g. 'incomplete' (checkout not finished) — nothing to entitle yet.
      return { kind: "ignore", reason: `unhandled subscription status '${status}'` };
    }
    return {
      kind: "set_subscription",
      plan: mapped.plan,
      status: normalized,
      customerId: event.customerId,
      subscriptionId: event.subscriptionId,
      periodStart: event.periodStart,
      periodEnd: event.periodEnd,
    };
  }

  if (event.kind === "order") {
    const mapped = event.productId ? products[event.productId] : undefined;
    if (mapped?.kind === "pack") {
      // Grant only on the PAID signal: Polar fires order.created before the
      // payment is captured — crediting there would hand out minutes for an
      // order that may never settle. Subscribing to order.paid is part of the
      // endpoint checklist (docs/BILLING.md).
      if (event.type !== "order.paid") {
        return { kind: "ignore", reason: `pack order ${event.orderId ?? "?"} not paid yet (${event.type})` };
      }
      return {
        kind: "grant_credits",
        meter: mapped.meter,
        qty: mapped.qty,
        // The order id (not the event id) is the dedupe ref: the same order can
        // arrive on several event types/redeliveries; it must grant once.
        providerRef: event.orderId ?? event.id,
        reason: "pack purchase (order.paid)",
      };
    }
    // Plan charges and renewals also emit order events — the subscription
    // events carry the entitlement, so these are bookkeeping only.
    return { kind: "ignore", reason: `order for non-pack product ${event.productId ?? "?"}` };
  }

  return { kind: "ignore", reason: `unhandled event type '${event.type}'` };
}
