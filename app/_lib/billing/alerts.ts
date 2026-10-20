import type { BillingAlert } from "@/app/_lib/db/billing";

// The billing alert READER (docs/features/billing/README.md → "Billing alerts").
//
// Two producers write `billing_alerts` (app/_lib/billing/sync.ts): a PAID subscription
// whose product is not mapped to a plan (`unmapped_product` — the customer paid and is
// NOT entitled; attributed to the paying org), the daily catalog-vs-provider price
// check (`price_drift` — a DEPLOYMENT-level fact, stored under the default org) and,
// behind KP_BILLING_SUBSCRIPTION_RECONCILE=1, the daily subscription reconcile
// (`subscription_drift` — a lost webhook, also stored under the default org). This
// module is the one place that decides what a reader of those rows is shown:
//
//   - the closed kind vocabulary (literal array → derived union → runtime guard, the
//     tabs.ts pattern);
//   - the AUDIENCE of each kind: an org owner reads their own org's customer-facing
//     alerts as a code the tab localizes; deployment-level kinds reach the home-org
//     operator only (the same home-org tier as requireHomeOrgReader);
//   - the provider `detail` (product ids, env names, prices) is operator information
//     and is withheld from everyone else — the projection simply does not carry it.
//
// Pure: no DB, no auth. The route decides who is a home-org reader and which rows to
// read; this decides what those rows become on the wire.

export const BILLING_ALERT_KINDS = ["unmapped_product", "price_drift", "subscription_drift"] as const;
export type BillingAlertKind = (typeof BILLING_ALERT_KINDS)[number];

export function isBillingAlertKind(value: unknown): value is BillingAlertKind {
  return typeof value === "string" && (BILLING_ALERT_KINDS as readonly string[]).includes(value);
}

/** How an alert ended: the underlying cause was FIXED, or it was DISMISSED as noise.
 *  Kept on the row so a later look at the worklist can tell the two apart. */
export const BILLING_ALERT_RESOLUTIONS = ["fixed", "dismissed"] as const;
export type BillingAlertResolution = (typeof BILLING_ALERT_RESOLUTIONS)[number];

export function isBillingAlertResolution(value: unknown): value is BillingAlertResolution {
  return typeof value === "string" && (BILLING_ALERT_RESOLUTIONS as readonly string[]).includes(value);
}

export type BillingAlertAudience = "customer" | "operator";

/** Who each kind is FOR. `price_drift` is about the deployment's catalog, not about
 *  any one customer's subscription, so only the operator who can fix the provider
 *  dashboard is shown it. */
const KIND_AUDIENCE: Record<BillingAlertKind, BillingAlertAudience> = {
  unmapped_product: "customer",
  price_drift: "operator",
  // The daily subscription reconcile (subscription-reconcile.ts): the provider and our
  // stored state disagree about one customer's subscription. Operator-only although it
  // concerns a customer — the row is stored under the default org, names another org's
  // subscription, and the fix (replay the lost delivery, re-sync) is the operator's.
  subscription_drift: "operator",
};

/** Deployment-level kinds — recorded under the default org, read only by the home-org
 *  operator (the route adds the default org's rows of these kinds for that reader). */
export const DEPLOYMENT_ALERT_KINDS: readonly BillingAlertKind[] = BILLING_ALERT_KINDS.filter(
  (kind) => KIND_AUDIENCE[kind] === "operator"
);

export type BillingAlertView = {
  id: number;
  /** A known kind, or `unknown` for a kind written by a newer writer than this reader
   *  — shown, never silently dropped. */
  code: BillingAlertKind | "unknown";
  audience: BillingAlertAudience;
  createdAt: string;
  /** The raw provider detail. PRESENT only for the home-org operator. */
  detail?: string;
};

/** Project stored alert rows onto what this reader may see, preserving row order. */
export function billingAlertViews(rows: readonly BillingAlert[], opts: { homeOrgReader: boolean }): BillingAlertView[] {
  const views: BillingAlertView[] = [];
  for (const row of rows) {
    const code = isBillingAlertKind(row.kind) ? row.kind : "unknown";
    // An unknown kind is shown as a customer-level alert: it is on the reader's own
    // org (the route reads org-bound rows), and its detail stays withheld anyway.
    const audience: BillingAlertAudience = code === "unknown" ? "customer" : KIND_AUDIENCE[code];
    if (audience === "operator" && !opts.homeOrgReader) continue;
    const view: BillingAlertView = { id: row.id, code, audience, createdAt: row.createdAt };
    if (opts.homeOrgReader) view.detail = row.detail;
    views.push(view);
  }
  return views;
}
