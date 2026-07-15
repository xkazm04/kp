import { ensureDb } from "./core";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// ---- Payment gate (docs/BILLING.md) ----------------------------------------
// Plain row accessors only; plan catalog, entitlement math, gateway calls, and
// webhook reduction live in app/_lib/billing/ so this file stays a dumb store.
// Single-workspace model: billing_state has exactly one row, keyed by the default
// workspace id ('workspace'). The read accepts a workspace scope (tenancy arc) so
// the gate can pass the requesting tenant; until per-tenant billing rows exist,
// the default id reads the same single row as before (byte-identical).

export type BillingStateRow = {
  plan: string;
  status: string;
  provider: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  updatedAt: string;
};

const WORKSPACE = "workspace";

export function getBillingState(workspaceId: string = DEFAULT_WORKSPACE_ID): BillingStateRow | null {
  const db = ensureDb();
  // billing_state is keyed by workspace id; the single seeded row uses the default
  // workspace id, so the no-arg default reads exactly the row it read before. A
  // non-default tenant reads its own row (none yet → null → the free plan), which
  // is the per-tenant seam this parameter opens without touching pricing math.
  const r = db.prepare(`SELECT * FROM billing_state WHERE id = ?`).get(workspaceId) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return {
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

export function upsertBillingState(input: {
  plan: string;
  status: string;
  provider?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
}): void {
  const db = ensureDb();
  db.prepare(
    `INSERT INTO billing_state
       (id, plan, status, provider, provider_customer_id, provider_subscription_id,
        current_period_start, current_period_end, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       plan = excluded.plan,
       status = excluded.status,
       provider = excluded.provider,
       provider_customer_id = excluded.provider_customer_id,
       provider_subscription_id = excluded.provider_subscription_id,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       updated_at = excluded.updated_at`
  ).run(
    WORKSPACE,
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
 *  process it); false on a redelivery (caller must skip side effects). */
export function insertBillingEvent(id: string, type: string, payloadJson: string): boolean {
  const db = ensureDb();
  const info = db
    .prepare(
      `INSERT INTO billing_events (id, type, payload_json, received_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`
    )
    .run(id, type, payloadJson, new Date().toISOString());
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
}): boolean {
  const db = ensureDb();
  const info = db
    .prepare(
      `INSERT INTO billing_credits (meter, delta, reason, provider_ref, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (provider_ref) DO NOTHING`
    )
    .run(input.meter, input.delta, input.reason, input.providerRef ?? null, new Date().toISOString());
  return Number(info.changes) > 0;
}

export type BillingAlert = {
  id: number;
  kind: string;
  detail: string;
  providerRef: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

/** Record a durable "needs attention" billing signal (e.g. a paid-but-unmapped
 *  subscription). `providerRef` (when given) de-duplicates redeliveries so the same
 *  unresolved alert isn't inserted twice. Returns true when a new row was inserted. */
export function recordBillingAlert(input: { kind: string; detail: string; providerRef?: string | null }): boolean {
  const db = ensureDb();
  // Don't pile up duplicate OPEN alerts for the same ref (a webhook redelivery).
  if (input.providerRef) {
    const dupe = db
      .prepare(`SELECT 1 FROM billing_alerts WHERE provider_ref = ? AND resolved_at IS NULL LIMIT 1`)
      .get(input.providerRef);
    if (dupe) return false;
  }
  const info = db
    .prepare(`INSERT INTO billing_alerts (kind, detail, provider_ref, created_at) VALUES (?, ?, ?, ?)`)
    .run(input.kind, input.detail, input.providerRef ?? null, new Date().toISOString());
  return Number(info.changes) > 0;
}

/** List billing alerts, unresolved first (newest first). Defaults to unresolved
 *  only — the "paid but dark" worklist for an admin surface / health check. */
export function listBillingAlerts(opts: { includeResolved?: boolean } = {}): BillingAlert[] {
  const db = ensureDb();
  const where = opts.includeResolved ? "" : "WHERE resolved_at IS NULL";
  const rows = db
    .prepare(`SELECT id, kind, detail, provider_ref, created_at, resolved_at FROM billing_alerts ${where} ORDER BY id DESC`)
    .all() as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    kind: String(r.kind),
    detail: String(r.detail),
    providerRef: (r.provider_ref as string) ?? null,
    createdAt: String(r.created_at),
    resolvedAt: (r.resolved_at as string) ?? null,
  }));
}

export function creditBalance(meter: string): number {
  const db = ensureDb();
  const row = db.prepare(`SELECT COALESCE(SUM(delta), 0) AS n FROM billing_credits WHERE meter = ?`).get(meter) as {
    n: number;
  };
  return row.n;
}

export function incrementBillingUsage(meter: string, period: string, qty: number): void {
  const db = ensureDb();
  db.prepare(
    `INSERT INTO billing_usage (meter, period, qty) VALUES (?, ?, ?)
     ON CONFLICT (meter, period) DO UPDATE SET qty = qty + excluded.qty`
  ).run(meter, period, qty);
}

export function billingUsageFor(meter: string, period: string): number {
  const db = ensureDb();
  const row = db.prepare(`SELECT qty FROM billing_usage WHERE meter = ? AND period = ?`).get(meter, period) as
    | { qty: number }
    | undefined;
  return row?.qty ?? 0;
}
