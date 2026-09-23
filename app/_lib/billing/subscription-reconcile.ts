// Subscription reconciliation: the provider's own record of a subscription, read back
// daily, against what we stored (docs/features/billing/README.md → "A lost webhook is
// flagged daily, never corrected").
//
// The webhook is the ONLY write path for money state (sync.ts), and it is lossy with no
// signal: a deployment unreachable past the provider's retry window loses the delivery
// outright, and a CAS-dropped set or revoke answers 2xx, so it is never redelivered. This
// module is the pure half of a standing check — the same shape as price-reconcile.ts:
// the fetches happen in the caller (sync.ts → runSubscriptionReconcile), an unreadable
// read is NO verdict, and the output is a drift the caller turns into ONE deduped
// operator alert. It never proposes a write to billing_state: correcting state from a
// pull would move an entitlement, which is a separate, irreversible decision.
//
// The decision reuses the webhook's own reducer. "What would the webhook have stored,
// had this delivery arrived?" is exactly reduceBillingEvent over the provider's current
// subscription object, so the status vocabulary, the ended set and the product map are
// read from ONE place and cannot drift from the write path they audit.
//
// DEFAULT OFF behind KP_BILLING_SUBSCRIPTION_RECONCILE=1: the provider GET has not been
// exercised against a live sandbox yet, and the README names that pass as owed before
// the flag is set in production.

import { getBillingState, listProviderSubscriptionsForReconcile, recordBillingAlert, type BillingStateRow } from "../db/billing";
import { isOffline } from "../offline";
import type { ProductMap } from "./gateway";
import { mapPolarEvent, polarGatewayFromEnv } from "./polar";
import { reduceBillingEvent } from "./reduce";

/** The env switch. Anything other than exactly "1" is off. */
export const SUBSCRIPTION_RECONCILE_FLAG = "KP_BILLING_SUBSCRIPTION_RECONCILE";

export function subscriptionReconcileEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SUBSCRIPTION_RECONCILE_FLAG] === "1";
}

/** Subscriptions read per daily run. A deployment with more stored subscriptions than
 *  this checks the stalest-updated ones first (the rows most likely to have missed a
 *  delivery) and the rest on later days; the bound exists because every read is one
 *  provider call, on a timer, against the operator's quota. */
export const SUBSCRIPTION_RECONCILE_MAX_PER_RUN = 100;

/** Period ends within this of each other agree — providers and our ISO round-trip
 *  disagree on sub-second precision, and a renewal moves the end by weeks. */
export const PERIOD_END_TOLERANCE_MS = 60 * 60 * 1000;

export const SUBSCRIPTION_DRIFT_KINDS = [
  "missed_activation",
  "missed_revocation",
  "plan_mismatch",
  "status_mismatch",
  "missed_renewal",
] as const;
export type SubscriptionDriftKind = (typeof SUBSCRIPTION_DRIFT_KINDS)[number];

export type SubscriptionDrift = {
  kind: SubscriptionDriftKind;
  /** `error`: the customer's entitlement is wrong today (paid and dark, or unpaid and
   *  entitled). `warn`: the stored row is stale in a way that has not cut anyone yet. */
  severity: "error" | "warn";
  subscriptionId: string | null;
  detail: string;
};

/** What the provider says about one subscription, flattened. */
export type ProviderSubscription = {
  id?: string | null;
  status: string;
  productId: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
};

export type StoredSubscription = Pick<BillingStateRow, "plan" | "status" | "providerSubscriptionId"> & {
  orgId?: string;
  currentPeriodEnd?: string | null;
};

/** The dedupe key of a drift alert: one OPEN alert per subscription, whatever the kind,
 *  so a standing disagreement is one row rather than one a day. */
export function subscriptionDriftRef(subscriptionId: string | null): string {
  return `sub-drift:${subscriptionId ?? "unknown"}`;
}

/** Read a provider subscription object (GET /v1/subscriptions/{id}) with the SAME field
 *  reads mapPolarEvent applies to a webhook's `data` — the object a delivery carries is
 *  the object this endpoint returns. Anything without an id-independent status is null:
 *  no status, no verdict. */
export function readProviderSubscription(body: unknown): ProviderSubscription | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const event = mapPolarEvent("reconcile", { type: "subscription.updated", data: body });
  if (!event.status) return null;
  return {
    id: event.subscriptionId,
    status: event.status,
    productId: event.productId,
    currentPeriodStart: event.periodStart,
    currentPeriodEnd: event.periodEnd,
  };
}

function endMs(value: string | null | undefined): number {
  return value ? Date.parse(value) : NaN;
}

/** Compare one stored subscription with the provider's current record. Returns the
 *  drift, or null when they agree OR when no honest verdict is possible:
 *   - the provider could not be read (null);
 *   - the provider object is a different subscription than the one we asked about;
 *   - the product is not mapped to a plan (the webhook's `unmapped_product` alert owns
 *     that case — raising it twice would be two alarms for one cause);
 *   - the provider status is one the webhook would ignore (e.g. `incomplete`);
 *   - a stored free row against a provider that is past_due / unpaid / canceled: the
 *     webhook would have stored it, but whether it entitles anyone today depends on a
 *     grace window, and an alarm that is wrong half the time gets muted.
 *  A provider period end EARLIER than the stored one is not flagged either: the stored
 *  row is newer than the read, which is the out-of-order guard working, not a loss. */
export function reconcileSubscriptionState(
  stored: StoredSubscription,
  provider: ProviderSubscription | null,
  products: ProductMap
): SubscriptionDrift | null {
  if (!provider) return null;
  const subscriptionId = stored.providerSubscriptionId ?? provider.id ?? null;
  if (provider.id && stored.providerSubscriptionId && provider.id !== stored.providerSubscriptionId) return null;
  const would = reduceBillingEvent(
    {
      id: "reconcile",
      type: "subscription.updated",
      kind: "subscription",
      productId: provider.productId,
      status: provider.status,
      customerId: null,
      subscriptionId,
      orderId: null,
      periodStart: provider.currentPeriodStart ?? null,
      periodEnd: provider.currentPeriodEnd ?? null,
      raw: null,
    },
    products
  );
  const storedEntitled = stored.plan !== "free";
  const drift = (kind: SubscriptionDriftKind, severity: SubscriptionDrift["severity"], detail: string): SubscriptionDrift => ({
    kind,
    severity,
    subscriptionId,
    detail: `${kind} ${subscriptionId ?? "?"}: ${detail}`,
  });

  if (would.kind === "clear_subscription") {
    return storedEntitled
      ? drift("missed_revocation", "error", `provider says '${provider.status}', stored plan=${stored.plan} status=${stored.status}`)
      : null;
  }
  if (would.kind !== "set_subscription") return null;

  if (!storedEntitled) {
    return would.status === "active" || would.status === "trialing"
      ? drift("missed_activation", "error", `provider says ${would.plan}/${would.status}, stored plan=free status=${stored.status}`)
      : null;
  }
  if (stored.plan !== would.plan) {
    return drift("plan_mismatch", "error", `provider plan=${would.plan}, stored plan=${stored.plan}`);
  }
  if (stored.status !== would.status) {
    return drift("status_mismatch", "warn", `provider status=${would.status}, stored status=${stored.status}`);
  }
  const providerEnd = endMs(would.periodEnd);
  const storedEnd = endMs(stored.currentPeriodEnd);
  if (Number.isFinite(providerEnd) && (!Number.isFinite(storedEnd) || providerEnd - storedEnd > PERIOD_END_TOLERANCE_MS)) {
    return drift("missed_renewal", "warn", `provider period ends ${would.periodEnd}, stored ${stored.currentPeriodEnd ?? "none"}`);
  }
  return null;
}

// ---- the runner: reads + the one write (billing_alerts) --------------------------
//
// Lives HERE rather than in sync.ts: sync.ts is re-exported by the billing barrel
// (index.ts), which most API routes import, and a clock-only pass has no business
// in every route's import graph. The clock imports this module directly.

/** What the subscription reconcile needs from a provider: one read per stored
 *  subscription, and the product map the webhook reduces with. PolarGateway is one;
 *  tests pass a literal. */
export type SubscriptionReconcileSource = {
  fetchSubscription(subscriptionId: string): Promise<unknown | null>;
  productMap(): ProductMap;
};

/** The lost-webhook check (subscription-reconcile.ts): read each stored subscription
 *  back from the provider and turn a disagreement into ONE deduped operator alert.
 *
 *  It WRITES ONLY billing_alerts. Money state stays the webhook's alone (sync.ts's
 *  header): a pull that corrected billing_state would move an entitlement on the say of
 *  a read nobody has validated against a live provider yet, so the answer to "the
 *  provider says this customer paid and we hold them on Free" is an alarm an operator
 *  acts on, never a silent upgrade.
 *
 *  DEFAULT OFF. It answers `skipped`, fetches nothing and writes nothing unless
 *  KP_BILLING_SUBSCRIPTION_RECONCILE=1 — and even then under KP_OFFLINE or with no
 *  provider configured. The flag is read here as well as at the clock's registration,
 *  so no caller can run the pass by reaching the function directly.
 *
 *  Reads happen outside any transaction; the stored row is re-read after each fetch
 *  and a row that moved meanwhile (a webhook landed) gets no verdict this run.
 *  `source` and `env` are injectable for tests; production passes nothing. */
export async function runSubscriptionReconcile(
  source: SubscriptionReconcileSource | null = polarGatewayFromEnv(),
  env: NodeJS.ProcessEnv = process.env
): Promise<{ skipped: boolean; checked: number; drifts: number; alerted: number }> {
  if (!subscriptionReconcileEnabled(env) || isOffline(env) || !source) {
    return { skipped: true, checked: 0, drifts: 0, alerted: 0 };
  }
  const products = source.productMap();
  let checked = 0;
  let drifts = 0;
  let alerted = 0;
  for (const stored of listProviderSubscriptionsForReconcile(SUBSCRIPTION_RECONCILE_MAX_PER_RUN)) {
    const subscriptionId = stored.providerSubscriptionId;
    if (!subscriptionId) continue;
    const provider = readProviderSubscription(await source.fetchSubscription(subscriptionId));
    if (!provider) continue;
    // The fetch took up to the request budget; a delivery may have landed meanwhile.
    // Judge only the row the read was compared with.
    const now = getBillingState(stored.orgId);
    if (!now || now.updatedAt !== stored.updatedAt) continue;
    checked += 1;
    const drift = reconcileSubscriptionState(stored, provider, products);
    if (!drift) continue;
    drifts += 1;
    const detail = `org ${stored.orgId}: ${drift.detail}`;
    console.error(`[billing:reconcile] SUBSCRIPTION DRIFT (${drift.severity}) — the provider and the stored state disagree: ${detail}`);
    // Stored under the default org, like price_drift: the operator's worklist, not the
    // customer's (alerts.ts KIND_AUDIENCE). One open alert per subscription.
    if (recordBillingAlert({ kind: "subscription_drift", detail, providerRef: subscriptionDriftRef(drift.subscriptionId) })) {
      alerted += 1;
    }
  }
  return { skipped: false, checked, drifts, alerted };
}
