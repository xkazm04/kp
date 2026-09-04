// Webhook ingestion: verify → idempotency gate → reduce (pure) → apply (DB).
// The single write path for money state; nothing else mutates billing_state.

import { billingOrgForProviderRefs, getBillingState, grantBillingCredits, insertBillingEvent, recordBillingAlert, upsertBillingState } from "../db/billing";
import { ensureDb } from "../db/core";
import { DEFAULT_ORG_ID } from "../db/organizations";
import type { BillingEvent, BillingGateway } from "./gateway";
import { polarGatewayFromEnv } from "./polar";
import { priceTargets, reconcileFetchedProducts, type ReconcileSource } from "./price-reconcile";
import {
  clearSubscriptionIsStale,
  reduceBillingEvent,
  setForRevokedSubscriptionIsStale,
  subscriptionWriteIsStale,
  type BillingAction,
} from "./reduce";

export type IngestResult = {
  eventId: string;
  type: string;
  action: BillingAction["kind"];
  duplicate: boolean;
  detail?: string;
};

/** Which org a verified webhook event belongs to (org-plan Phase 3). Precedence:
 *  1) the checkout metadata the event carries (`kpOrgId` — stamped by our own
 *     checkout create, propagated by the provider onto its subscription/order);
 *  2) the org whose stored billing_state already holds this subscription/customer
 *     (renewals + portal changes for a subscription minted before metadata);
 *  3) the default org — the exact single-tenant behavior every pre-org
 *     deployment has today. */
export function resolveBillingOrg(event: BillingEvent): string {
  return event.orgId ?? billingOrgForProviderRefs(event.subscriptionId, event.customerId) ?? DEFAULT_ORG_ID;
}

export function applyBillingAction(action: BillingAction, provider: string, orgId: string = DEFAULT_ORG_ID): string | undefined {
  switch (action.kind) {
    case "set_subscription": {
      // Out-of-order guard: Polar does NOT guarantee ordered delivery, so a stale
      // subscription.updated (e.g. an older past_due snapshot) can land AFTER the
      // newer active renewal and blindly overwrite a current customer to a worse
      // state. For the SAME subscription, refuse a write whose periodStart is older
      // than what's already stored (a missing/unparseable period or a different
      // subscription id — a genuine re-subscribe — still applies).
      const prior = getBillingState(orgId);
      if (subscriptionWriteIsStale(prior?.providerSubscriptionId ?? null, prior?.currentPeriodStart ?? null, action.subscriptionId, action.periodStart)) {
        return `stale subscription event ignored (period ${action.periodStart ?? "?"} not newer than stored)`;
      }
      // Out-of-order guard (re-entitlement direction): a REORDERED pre-revoke `active`
      // for a subscription already cleared to free (its id kept as a tombstone below)
      // must not re-entitle a canceled customer. The period anchor is nulled on clear,
      // so the check above can't catch this; the tombstone id can.
      if (setForRevokedSubscriptionIsStale(prior?.plan ?? "free", prior?.providerSubscriptionId ?? null, action.subscriptionId)) {
        return `stale re-entitlement ignored (subscription ${action.subscriptionId ?? "?"} was already revoked)`;
      }
      // A `canceled` (cancel-at-period-end) carries the grace period in periodEnd;
      // entitledPlan keeps the customer until it passes. If Polar omits/malforms it,
      // surface LOUDLY (like the unmapped path) — entitledPlan now favors the customer
      // on an unparseable end, so this is the only signal that the data gap exists.
      if (action.status === "canceled" && !Number.isFinite(action.periodEnd ? Date.parse(action.periodEnd) : NaN)) {
        console.error(
          `[billing:webhook] CANCELED subscription ${action.subscriptionId ?? "?"} has no parseable currentPeriodEnd (${action.periodEnd ?? "null"}) — grace cutoff is unknown; keeping the plan. Check the Polar payload.`
        );
      }
      upsertBillingState({
        orgId,
        plan: action.plan,
        status: action.status,
        provider,
        providerCustomerId: action.customerId,
        providerSubscriptionId: action.subscriptionId,
        currentPeriodStart: action.periodStart,
        currentPeriodEnd: action.periodEnd,
      });
      return `plan=${action.plan} status=${action.status}`;
    }
    case "clear_subscription": {
      // Keep the customer id — the portal (and any win-back checkout) still
      // needs to address the same MoR customer after the plan lapses.
      const prior = getBillingState(orgId);
      // Out-of-order guard (revenue-losing direction): a delayed/retried `revoked`
      // for an OLD subscription must not wipe a NEWER active one the customer
      // re-subscribed to. Skip the clear when the revoke targets a different
      // subscription than the one currently stored. (Polar does not guarantee order.)
      if (clearSubscriptionIsStale(prior?.providerSubscriptionId ?? null, action.subscriptionId)) {
        return `stale revoke ignored (a newer subscription ${prior?.providerSubscriptionId} is active)`;
      }
      upsertBillingState({
        orgId,
        plan: "free",
        status: "none",
        provider,
        providerCustomerId: action.customerId ?? prior?.providerCustomerId ?? null,
        // Keep the revoked subscription id as a TOMBSTONE (not null): the set-path
        // `setForRevokedSubscriptionIsStale` guard uses it to reject a reordered
        // pre-revoke `active` for this same, now-dead subscription (a genuine
        // re-subscribe arrives under a new id, which the guard lets through). The
        // period anchors are nulled — there's no live period once cleared.
        providerSubscriptionId: action.subscriptionId ?? prior?.providerSubscriptionId ?? null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
      });
      return "plan=free";
    }
    case "grant_credits": {
      const granted = grantBillingCredits({
        orgId,
        meter: action.meter,
        delta: action.qty,
        reason: action.reason,
        providerRef: action.providerRef,
      });
      return granted
        ? `${action.qty >= 0 ? "+" : ""}${action.qty} ${action.meter}`
        : `duplicate grant ${action.providerRef} skipped`;
    }
    case "ignore":
      if (action.unmapped) {
        // A money event whose product id isn't configured → the subscriber is never
        // entitled, silently. Almost always POLAR_PRODUCT_* env drift (a recreated
        // product, sandbox ids in prod). Surface LOUDLY so an operator notices rather
        // than learning of it from a customer complaint. Still returns 2xx — a config
        // error won't fix on retry, so don't trap the provider in a redelivery loop;
        // the reason is persisted on billing_events for audit.
        console.error(
          `[billing:webhook] UNMAPPED PRODUCT on a money event — subscriber NOT entitled: ${action.reason}. Check POLAR_PRODUCT_* env against the Polar dashboard.`
        );
        // Durable, queryable signal (not just a log line): an admin surface / health
        // check can list paid-but-dark subscriptions. The event-id dedupe gate stops
        // identical REDELIVERIES; the stable providerRef (the dark subscription) then
        // collapses repeated DISTINCT subscription.updated events for the same
        // misconfiguration to ONE open alert instead of piling up N rows.
        // bug-ui-scan-2026-07-09 (billing-engine-webhooks #5)
        recordBillingAlert({ orgId, kind: "unmapped_product", detail: action.reason, providerRef: action.providerRef });
      }
      return action.reason;
  }
}

/** The webhook route's whole job. Throws on a bad signature (route → 400);
 *  everything verified is recorded, deduped, reduced, applied. */
export function ingestBillingWebhook(
  gateway: BillingGateway,
  rawBody: string,
  headers: Record<string, string | null>
): IngestResult {
  // Verify OUTSIDE the transaction: it touches no DB and a bad signature must 400
  // before we open a write.
  const event = gateway.verifyWebhook(rawBody, headers);
  const action = reduceBillingEvent(event, gateway.productMap());
  // Org attribution (org-plan Phase 3): metadata → stored subscription/customer
  // → default org. Resolved OUTSIDE the transaction (a read), applied inside.
  const orgId = resolveBillingOrg(event);

  // Idempotency gate + apply in ONE transaction. Previously insertBillingEvent
  // committed the dedupe row before applyBillingAction ran, so a transient apply
  // failure (SQLITE_BUSY, transient I/O) returned 500 → the provider's redelivery
  // hit the dedupe row → skipped the apply forever: the customer paid but the plan
  // never upgraded / credits never landed. Now the dedupe row only persists if the
  // apply commits — a throw rolls the whole tx back (including the insert), so the
  // retry reprocesses cleanly. (Every accessor uses the one ensureDb() singleton,
  // so these statements share the transaction.)
  const db = ensureDb();
  return db.transaction((): IngestResult => {
    const fresh = insertBillingEvent(event.id, event.type, rawBody, orgId);
    if (!fresh) {
      return { eventId: event.id, type: event.type, action: "ignore", duplicate: true, detail: "redelivery" };
    }
    const detail = applyBillingAction(action, gateway.provider, orgId);
    return { eventId: event.id, type: event.type, action: action.kind, duplicate: false, detail };
  })();
}

/** The price-drift check as a STANDING guard rather than a manual preflight.
 *
 *  The invariant is "the price the catalog DISPLAYS equals the price the provider
 *  CHARGES" (price-reconcile.ts). It was only ever checked by `scripts/polar-setup.mjs`,
 *  which an operator runs when they set the products up — i.e. exactly once, before the
 *  drift a later dashboard edit introduces. A money-trust break that only surfaces
 *  after a real charge needs a check that runs on its own.
 *
 *  Safe to call unconditionally. It answers `skipped` and touches nothing when billing
 *  is not configured or the deployment is offline (`polarGatewayFromEnv` returns null
 *  in both cases, by design — see its header), and a product it cannot read is treated
 *  as unknown rather than as drift.
 *
 *  `gateway` is injectable for tests; production passes nothing. */
export async function runPriceReconcile(
  gateway: ReconcileSource | null = polarGatewayFromEnv()
): Promise<{ skipped: boolean; checked: number; drifts: number; alerted: boolean }> {
  if (!gateway) return { skipped: true, checked: 0, drifts: 0, alerted: false };
  const targets = priceTargets(gateway.configuredProducts());
  if (targets.length === 0) return { skipped: true, checked: 0, drifts: 0, alerted: false };
  // The reads happen HERE, outside the decision and outside any transaction: the
  // pure half below takes what came back and never knows how it was obtained.
  const fetched = new Map<string, unknown>();
  for (const target of targets) {
    const product = await gateway.fetchProduct(target.productId);
    if (product !== null) fetched.set(target.productId, product);
  }
  const outcome = reconcileFetchedProducts(targets, fetched);
  let alerted = false;
  if (outcome.alert) {
    // Same durable channel the unmapped-product alarm uses, so an operator has ONE
    // worklist for "money is not behaving" instead of a log line nobody reads.
    console.error(`[billing:reconcile] PRICE DRIFT — the catalog and the provider disagree: ${outcome.alert.detail}`);
    alerted = recordBillingAlert({
      kind: "price_drift",
      detail: outcome.alert.detail,
      providerRef: outcome.alert.providerRef,
    });
  }
  return { skipped: false, checked: fetched.size, drifts: outcome.drifts.length, alerted };
}
