// Webhook ingestion: verify → idempotency gate → reduce (pure) → apply (DB).
// The single write path for money state; nothing else mutates billing_state.

import { ensureDb, getBillingState, grantBillingCredits, insertBillingEvent, upsertBillingState } from "../db";
import type { BillingGateway } from "./gateway";
import { clearSubscriptionIsStale, reduceBillingEvent, subscriptionWriteIsStale, type BillingAction } from "./reduce";

export type IngestResult = {
  eventId: string;
  type: string;
  action: BillingAction["kind"];
  duplicate: boolean;
  detail?: string;
};

export function applyBillingAction(action: BillingAction, provider: string): string | undefined {
  switch (action.kind) {
    case "set_subscription": {
      // Out-of-order guard: Polar does NOT guarantee ordered delivery, so a stale
      // subscription.updated (e.g. an older past_due snapshot) can land AFTER the
      // newer active renewal and blindly overwrite a current customer to a worse
      // state. For the SAME subscription, refuse a write whose periodStart is older
      // than what's already stored (a missing/unparseable period or a different
      // subscription id — a genuine re-subscribe — still applies).
      const prior = getBillingState();
      if (subscriptionWriteIsStale(prior?.providerSubscriptionId ?? null, prior?.currentPeriodStart ?? null, action.subscriptionId, action.periodStart)) {
        return `stale subscription event ignored (period ${action.periodStart ?? "?"} not newer than stored)`;
      }
      upsertBillingState({
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
      const prior = getBillingState();
      // Out-of-order guard (revenue-losing direction): a delayed/retried `revoked`
      // for an OLD subscription must not wipe a NEWER active one the customer
      // re-subscribed to. Skip the clear when the revoke targets a different
      // subscription than the one currently stored. (Polar does not guarantee order.)
      if (clearSubscriptionIsStale(prior?.providerSubscriptionId ?? null, action.subscriptionId)) {
        return `stale revoke ignored (a newer subscription ${prior?.providerSubscriptionId} is active)`;
      }
      upsertBillingState({
        plan: "free",
        status: "none",
        provider,
        providerCustomerId: action.customerId ?? prior?.providerCustomerId ?? null,
        providerSubscriptionId: null,
        currentPeriodStart: null,
        currentPeriodEnd: null,
      });
      return "plan=free";
    }
    case "grant_credits": {
      const granted = grantBillingCredits({
        meter: action.meter,
        delta: action.qty,
        reason: action.reason,
        providerRef: action.providerRef,
      });
      return granted ? `+${action.qty} ${action.meter}` : `duplicate grant ${action.providerRef} skipped`;
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
    const fresh = insertBillingEvent(event.id, event.type, rawBody);
    if (!fresh) {
      return { eventId: event.id, type: event.type, action: "ignore", duplicate: true, detail: "redelivery" };
    }
    const detail = applyBillingAction(action, gateway.provider);
    return { eventId: event.id, type: event.type, action: action.kind, duplicate: false, detail };
  })();
}
