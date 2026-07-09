// Pure webhook reducer: a normalized BillingEvent + the product map → ONE
// BillingAction. No I/O here — the route verifies, the idempotency gate
// dedupes, this decides, sync.ts applies. Keeping it pure makes the whole
// money-state machine unit-testable without a DB or a provider.

import type { BillingEvent, ProductMap } from "./gateway";
import type { Meter, PlanId } from "./plans";

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "unpaid" | "canceled";

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
  | { kind: "clear_subscription"; customerId: string | null; subscriptionId: string | null }
  | { kind: "grant_credits"; meter: Meter; qty: number; providerRef: string; reason: string }
  // `unmapped` marks an ignore that is NOT benign: a money event (a paying
  // subscription) whose product id isn't in the configured map, so the subscriber
  // is silently never entitled. The apply step logs these loudly (config drift).
  | { kind: "ignore"; reason: string; unmapped?: boolean };

// Provider statuses that mean "the subscription is gone, drop to free".
const ENDED_STATUSES = new Set(["revoked", "ended", "incomplete_expired", "expired"]);

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  // Dunning exhausted (Stripe/Polar lineage): all retries failed. NOT a benign
  // no-op — it must be STORED so entitledPlan can bound it by the failed-payment
  // grace and then drop to free, instead of the old `ignore` that left a stale
  // `active`/`past_due` row entitling the workspace forever.
  unpaid: "unpaid",
  canceled: "canceled", // cancel-at-period-end: stays entitled until periodEnd
  cancelled: "canceled",
};

// Order event types that REVERSE a settled pack grant (refund / dispute-loss /
// cancellation). The inverse of `order.paid`: they claw the granted credits back.
const REFUND_ORDER_TYPES = new Set(["order.refunded", "order.canceled", "order.cancelled"]);

/** Out-of-order guard for the apply step (sync.ts): true when an incoming
 *  subscription write would REGRESS an already-stored, SAME-subscription state to an
 *  OLDER period — a stale/reordered Polar delivery that must not overwrite a current
 *  customer. A different subscription id (a genuine re-subscribe) or a missing/
 *  unparseable period anchor is NOT stale (apply it); equal periods apply too (the
 *  status may legitimately change within a period). Pure so it's unit-testable. */
export function subscriptionWriteIsStale(
  storedSubscriptionId: string | null,
  storedPeriodStart: string | null,
  incomingSubscriptionId: string | null,
  incomingPeriodStart: string | null
): boolean {
  if (!incomingSubscriptionId || storedSubscriptionId !== incomingSubscriptionId) return false;
  if (!incomingPeriodStart || !storedPeriodStart) return false;
  const incoming = Date.parse(incomingPeriodStart);
  const stored = Date.parse(storedPeriodStart);
  if (!Number.isFinite(incoming) || !Number.isFinite(stored)) return false;
  return incoming < stored;
}

/** Out-of-order guard for a `clear_subscription` (revoke/ended) apply: true when the
 *  revoke is for a DIFFERENT subscription than the one currently stored — i.e. a
 *  delayed/retried `revoked` for an OLD subscription arriving after the customer has
 *  already re-subscribed (a newer `active` is live). Clearing then would silently
 *  downgrade a paying customer to free. The mirror of `subscriptionWriteIsStale` for
 *  the revenue-losing direction. When either id is unknown we can't prove staleness,
 *  so we DON'T skip (clear applies) — a genuine revoke must still drop entitlement. */
export function clearSubscriptionIsStale(
  storedSubscriptionId: string | null,
  revokedSubscriptionId: string | null
): boolean {
  return Boolean(storedSubscriptionId && revokedSubscriptionId && storedSubscriptionId !== revokedSubscriptionId);
}

/** Out-of-order guard for a `set_subscription` apply, complementing the period-anchor
 *  `subscriptionWriteIsStale`: true when the incoming set is a REORDERED pre-revoke
 *  event for a subscription we have ALREADY cleared to free. `clear_subscription`
 *  drops the plan to `free` but now RETAINS the revoked subscription id as a tombstone
 *  (sync.ts), so a delayed `active` for that same id — a common cancel/revoke reorder
 *  where the period anchor was nulled and thus can't prove staleness — is recognized
 *  and rejected here, instead of silently re-entitling a canceled customer. A genuine
 *  re-subscribe always carries a NEW subscription id (a revoked sub never reactivates
 *  under its old id), which this lets through (id mismatch → not stale). */
export function setForRevokedSubscriptionIsStale(
  storedPlan: string,
  storedSubscriptionId: string | null,
  incomingSubscriptionId: string | null
): boolean {
  if (!incomingSubscriptionId || !storedSubscriptionId) return false;
  if (storedSubscriptionId !== incomingSubscriptionId) return false;
  // A stored `free` plan against the same subscription id is a tombstone left by a
  // prior clear — the sub is dead, so any set for it is a late/out-of-order delivery.
  return storedPlan === "free";
}

export function reduceBillingEvent(event: BillingEvent, products: ProductMap): BillingAction {
  if (event.kind === "subscription") {
    const status = (event.status ?? "").toLowerCase();
    if (ENDED_STATUSES.has(status)) {
      // Carry the revoked subscription id so apply can ignore a REORDERED revoke:
      // a delayed `revoked` for an OLD subscription must not wipe a newer active one.
      return { kind: "clear_subscription", customerId: event.customerId, subscriptionId: event.subscriptionId };
    }
    const mapped = event.productId ? products[event.productId] : undefined;
    if (!mapped || mapped.kind !== "plan") {
      // A real subscription event whose product id isn't a configured plan — almost
      // always POLAR_PRODUCT_* env drift. Mark it `unmapped` so apply surfaces it
      // loudly instead of treating a paid-but-dark subscription as a benign no-op.
      return { kind: "ignore", reason: `subscription event for unmapped product ${event.productId ?? "?"}`, unmapped: true };
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
      if (event.type === "order.paid") {
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
      if (REFUND_ORDER_TYPES.has(event.type)) {
        // A refund / dispute-loss / cancellation on a paid pack is the inverse of the
        // grant: claw the credits back with a compensating NEGATIVE ledger row. Keyed
        // on `${orderId}:refund` — distinct from the grant's `${orderId}` so it debits
        // exactly once (the UNIQUE provider_ref makes a replayed `order.refunded`
        // idempotent). We reverse the FULL fixed pack qty and do NOT read the order's
        // amount: Polar's `refunded_amount` is CUMULATIVE (each redelivery repeats the
        // running total, not a per-event delta), so summing it would double-count; and
        // the minute pack is one indivisible SKU (there are no partial packs), so any
        // refund undoes the whole grant. The displayed balance is clamped to >=0 in
        // meterOverview so a claw-back past already-spent minutes never reads negative.
        const ref = event.orderId ? `${event.orderId}:refund` : `${event.id}:refund`;
        return {
          kind: "grant_credits",
          meter: mapped.meter,
          qty: -mapped.qty,
          providerRef: ref,
          reason: `pack refund (${event.type})`,
        };
      }
      // order.created (not captured) / order.updated / etc. — no settled signal yet.
      return { kind: "ignore", reason: `pack order ${event.orderId ?? "?"} not actionable (${event.type})` };
    }
    // Plan charges and renewals also emit order events — the subscription
    // events carry the entitlement, so these are bookkeeping only.
    return { kind: "ignore", reason: `order for non-pack product ${event.productId ?? "?"}` };
  }

  return { kind: "ignore", reason: `unhandled event type '${event.type}'` };
}
