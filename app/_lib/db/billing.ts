import { ensureDb } from "./core";
import { DEFAULT_ORG_ID } from "./organizations";

// ---- Payment gate (docs/features/billing/README.md) ----------------------------------------
// Plain row accessors only; plan catalog, entitlement math, gateway calls, and
// webhook reduction live in app/_lib/billing/ so this file stays a dumb store.
//
// ORG-scoped (org-plan Phase 3, data layer): billing is per-ORG — one
// subscription + one ledger per customer company, SHARED across the org's
// teams (the tenancy manifest's billing doctrine; per-team workspace_id
// scoping deliberately does not apply here). Every accessor defaults its
// orgId to the single seeded org, so a pre-multi-org deployment reads and
// writes exactly the rows it always did. The legacy billing_state row keeps
// its historical PK (id 'workspace'); a new org's row uses its org id as the
// PK — id is a pure function of the org, so the ON CONFLICT (id) upsert stays
// one-row-per-org (also enforced by uq_billing_state_org).

export type BillingStateRow = {
  orgId: string;
  plan: string;
  status: string;
  provider: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  updatedAt: string;
};

/** The legacy single-row PK value — kept stable for the default org so existing
 *  deployments' rows never rewrite. */
const LEGACY_STATE_ID = "workspace";

function stateIdFor(orgId: string): string {
  return orgId === DEFAULT_ORG_ID ? LEGACY_STATE_ID : orgId;
}

function rowToState(r: Record<string, unknown>): BillingStateRow {
  return {
    orgId: (r.org_id as string) ?? DEFAULT_ORG_ID,
    plan: r.plan as string,
    status: r.status as string,
    provider: (r.provider as string) ?? null,
    providerCustomerId: (r.provider_customer_id as string) ?? null,
    providerSubscriptionId: (r.provider_subscription_id as string) ?? null,
    currentPeriodStart: (r.current_period_start as string) ?? null,
    currentPeriodEnd: (r.current_period_end as string) ?? null,
    updatedAt: r.updated_at as string,
  };
}

export function getBillingState(orgId: string = DEFAULT_ORG_ID): BillingStateRow | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM billing_state WHERE org_id = ?`).get(orgId) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToState(r) : null;
}

/** Resolve which org a provider webhook belongs to when the event carries no
 *  metadata org: the org whose stored subscription (first — more specific) or
 *  customer matches. Null when nothing matches (the ingest falls back to the
 *  default org, preserving the single-org behavior). */
export function billingOrgForProviderRefs(subscriptionId: string | null, customerId: string | null): string | null {
  const db = ensureDb();
  if (subscriptionId) {
    const r = db.prepare(`SELECT org_id FROM billing_state WHERE provider_subscription_id = ?`).get(subscriptionId) as
      | { org_id?: string | null }
      | undefined;
    if (r?.org_id) return r.org_id;
  }
  if (customerId) {
    const r = db.prepare(`SELECT org_id FROM billing_state WHERE provider_customer_id = ?`).get(customerId) as
      | { org_id?: string | null }
      | undefined;
    if (r?.org_id) return r.org_id;
  }
  return null;
}

export function upsertBillingState(input: {
  orgId?: string;
  plan: string;
  status: string;
  provider?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
}): void {
  const db = ensureDb();
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  db.prepare(
    `INSERT INTO billing_state
       (id, org_id, plan, status, provider, provider_customer_id, provider_subscription_id,
        current_period_start, current_period_end, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       org_id = excluded.org_id,
       plan = excluded.plan,
       status = excluded.status,
       provider = excluded.provider,
       provider_customer_id = excluded.provider_customer_id,
       provider_subscription_id = excluded.provider_subscription_id,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       updated_at = excluded.updated_at`
  ).run(
    stateIdFor(orgId),
    orgId,
    input.plan,
    input.status,
    input.provider ?? null,
    input.providerCustomerId ?? null,
    input.providerSubscriptionId ?? null,
    input.currentPeriodStart ?? null,
    input.currentPeriodEnd ?? null,
    new Date().toISOString()
  );
}

/** Idempotency gate: true when this provider event id is new (caller should
 *  process it); false on a redelivery (caller must skip side effects). The PK
 *  (and thus the dedupe) is the provider's GLOBAL event id; org_id is recorded
 *  attribution only. */
export function insertBillingEvent(id: string, type: string, payloadJson: string, orgId: string = DEFAULT_ORG_ID): boolean {
  const db = ensureDb();
  const info = db
    .prepare(
      `INSERT INTO billing_events (id, org_id, type, payload_json, received_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`
    )
    .run(id, orgId, type, payloadJson, new Date().toISOString());
  return Number(info.changes) > 0;
}

/** Prepaid-credit ledger entry. `providerRef` (e.g. the Polar order id) is
 *  UNIQUE, so a webhook redelivered past the event gate still can't double-
 *  grant a pack. Returns true when the row was inserted. */
export function grantBillingCredits(input: {
  meter: string;
  delta: number;
  reason: string;
  providerRef?: string | null;
  orgId?: string;
}): boolean {
  const db = ensureDb();
  const info = db
    .prepare(
      `INSERT INTO billing_credits (org_id, meter, delta, reason, provider_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (provider_ref) DO NOTHING`
    )
    .run(input.orgId ?? DEFAULT_ORG_ID, input.meter, input.delta, input.reason, input.providerRef ?? null, new Date().toISOString());
  return Number(info.changes) > 0;
}

export type BillingAlert = {
  id: number;
  orgId: string;
  kind: string;
  detail: string;
  providerRef: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

/** Record a durable "needs attention" billing signal (e.g. a paid-but-unmapped
 *  subscription). `providerRef` (when given) de-duplicates redeliveries so the same
 *  unresolved alert isn't inserted twice. Returns true when a new row was inserted. */
export function recordBillingAlert(input: { kind: string; detail: string; providerRef?: string | null; orgId?: string }): boolean {
  const db = ensureDb();
  // Don't pile up duplicate OPEN alerts for the same ref (a webhook redelivery).
  if (input.providerRef) {
    const dupe = db
      .prepare(`SELECT 1 FROM billing_alerts WHERE provider_ref = ? AND resolved_at IS NULL LIMIT 1`)
      .get(input.providerRef);
    if (dupe) return false;
  }
  const info = db
    .prepare(`INSERT INTO billing_alerts (org_id, kind, detail, provider_ref, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(input.orgId ?? DEFAULT_ORG_ID, input.kind, input.detail, input.providerRef ?? null, new Date().toISOString());
  return Number(info.changes) > 0;
}

/** List billing alerts, unresolved first (newest first). Defaults to unresolved
 *  only — the "paid but dark" worklist for an admin surface / health check.
 *  DEPLOYMENT-scoped on purpose (no org filter): this is the operator's cross-
 *  customer worklist, and each row carries its orgId for attribution. */
export function listBillingAlerts(opts: { includeResolved?: boolean } = {}): BillingAlert[] {
  const db = ensureDb();
  const where = opts.includeResolved ? "" : "WHERE resolved_at IS NULL";
  const rows = db
    .prepare(`SELECT id, org_id, kind, detail, provider_ref, created_at, resolved_at FROM billing_alerts ${where} ORDER BY id DESC`)
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    orgId: (r.org_id as string) ?? DEFAULT_ORG_ID,
    kind: String(r.kind),
    detail: String(r.detail),
    providerRef: (r.provider_ref as string) ?? null,
    createdAt: String(r.created_at),
    resolvedAt: (r.resolved_at as string) ?? null,
  }));
}

export function creditBalance(meter: string, orgId: string = DEFAULT_ORG_ID): number {
  const db = ensureDb();
  const row = db
    .prepare(`SELECT COALESCE(SUM(delta), 0) AS n FROM billing_credits WHERE meter = ? AND org_id = ?`)
    .get(meter, orgId) as { n: number };
  return row.n;
}

export function incrementBillingUsage(meter: string, period: string, qty: number, orgId: string = DEFAULT_ORG_ID): void {
  const db = ensureDb();
  db.prepare(
    `INSERT INTO billing_usage (org_id, meter, period, qty) VALUES (?, ?, ?, ?)
     ON CONFLICT (org_id, meter, period) DO UPDATE SET qty = qty + excluded.qty`
  ).run(orgId, meter, period, qty);
}

export function billingUsageFor(meter: string, period: string, orgId: string = DEFAULT_ORG_ID): number {
  const db = ensureDb();
  const row = db.prepare(`SELECT qty FROM billing_usage WHERE meter = ? AND period = ? AND org_id = ?`).get(meter, period, orgId) as
    | { qty: number }
    | undefined;
  return row?.qty ?? 0;
}
