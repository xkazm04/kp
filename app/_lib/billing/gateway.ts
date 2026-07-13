// The hedge seam (docs/BILLING.md): everything provider-specific sits behind
// this interface so a later Paddle (or other MoR) migration is a bounded swap —
// implement BillingGateway + a product map, and the routes, reducer, DB tables,
// and entitlement math stay untouched. Keep provider types OUT of this file.

import type { Meter, PackId, PlanId } from "./plans";

export type CheckoutRequest =
  | { kind: "plan"; plan: Exclude<PlanId, "free"> }
  | { kind: "pack"; pack: PackId };

export type Checkout = { url: string; providerCheckoutId: string | null };

/** Provider-agnostic webhook event, normalized by the gateway's verifyWebhook.
 *  `id` is the provider's delivery/event id — the idempotency key. */
export type BillingEvent = {
  id: string;
  type: string;
  kind: "subscription" | "order" | "other";
  productId: string | null;
  status: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  orderId: string | null;
  // Units purchased on an order (Polar one-time products support a per-checkout
  // quantity). mapPolarEvent always sets it (>= 1); optional so hand-built events
  // (tests / other providers) may omit it — the reducer treats absent as 1. Pack
  // grants multiply the fixed pack size by this so a multi-unit order isn't
  // under-delivered. bug-ui-scan-2026-07-09 (billing-engine-webhooks #4)
  quantity?: number;
  periodStart: string | null;
  periodEnd: string | null;
  raw: unknown;
};

/** What a product id means to US — built from env/config per provider. */
export type ProductMapping =
  | { kind: "plan"; plan: Exclude<PlanId, "free"> }
  | { kind: "pack"; meter: Meter; qty: number };

export type ProductMap = Record<string, ProductMapping>;

/** Operator misconfiguration (missing secret/product id) — distinct from a
 *  bad request or a provider outage so routes can answer 503 with the fix. */
export class BillingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigError";
  }
}

export interface BillingGateway {
  readonly provider: string;
  /** Map of provider product ids → plans/packs (drives the reducer). */
  productMap(): ProductMap;
  createCheckout(req: CheckoutRequest, opts: { successUrl: string }): Promise<Checkout>;
  createPortalSession(customerId: string): Promise<{ url: string }>;
  /** Verify signature + freshness and normalize. MUST throw on a bad signature. */
  verifyWebhook(rawBody: string, headers: Record<string, string | null>): BillingEvent;
}
