// Webhook ingestion: verify → idempotency gate → reduce (pure) → apply (DB).
// The single write path for money state; nothing else mutates billing_state.

import { ensureDb, getBillingState, grantBillingCredits, insertBillingEvent, upsertBillingState } from "../db";
import type { BillingGateway } from "./gateway";
import { reduceBillingEvent, type BillingAction } from "./reduce";

export type IngestResult = {
  eventId: string;
  type: string;
  action: BillingAction["kind"];
  duplicate: boolean;
  detail?: string;
};

export function applyBillingAction(action: BillingAction, provider: string): string | undefined {
  switch (action.kind) {
    case "set_subscription":
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
    case "clear_subscription": {
      // Keep the customer id — the portal (and any win-back checkout) still
      // needs to address the same MoR customer after the plan lapses.
      const prior = getBillingState();
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
