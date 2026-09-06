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

/** Write the org's money state.
 *
 *  COMPARE-AND-SWAP, opt-in via `expectedUpdatedAt` (the read→compute→write rule in
 *  `.claude/CLAUDE.md`). The webhook's staleness decisions (`subscriptionWriteIsStale`,
 *  `clearSubscriptionIsStale`, `setForRevokedSubscriptionIsStale`) are computed a layer
 *  up in `sync.ts` from a `getBillingState()` SELECT, and the UPDATE below used to
 *  re-assert nothing: any second writer that landed between that SELECT and this write
 *  was silently overwritten, so a concurrent delivery could regress a paying customer's
 *  plan with no error and no failing test. The strategy chosen here is the COMPENSATING
 *  PRECONDITION (not `.immediate()`): the caller passes the `updated_at` its decision was
 *  computed from and the `DO UPDATE` re-asserts it in a `WHERE`, so a row that moved makes
 *  `res.changes === 0` and the write is DROPPED rather than applied to a state nobody
 *  reasoned about. That keeps the ingest transaction in `sync.ts` unchanged — it already
 *  wraps the dedupe insert and the apply together — and needs no write lock at BEGIN.
 *
 *  The key's PRESENCE is the discriminator, so the two intents stay distinguishable:
 *   - absent            → unconditional write (fixtures, tests, the seeded default row);
 *   - `null`            → "I read NO row" — an existing row means someone else wrote
 *                          first, so the write is skipped;
 *   - an ISO timestamp  → "the row I read said this" — any other value skips.
 *
 *  Returns true when the row was written, false when the precondition rejected it. */
export function upsertBillingState(input: {
  orgId?: string;
  plan: string;
  status: string;
  provider?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  expectedUpdatedAt?: string | null;
}): boolean {
  const db = ensureDb();
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  const cas = "expectedUpdatedAt" in input;
  const expected = input.expectedUpdatedAt ?? null;
  // `updated_at` is the CAS token, so it must MOVE on every write. ISO strings are
  // millisecond-resolution and these writes are synchronous: two applies inside one
  // millisecond would stamp the same value, and the second writer's precondition would
  // then match a row it never read (an ABA). Advance past the token we are swapping out.
  let stampedAt = new Date().toISOString();
  if (cas && expected && stampedAt <= expected) {
    const bumped = Date.parse(expected);
    if (Number.isFinite(bumped)) stampedAt = new Date(bumped + 1).toISOString();
  }
  // `IS ?` rather than `= ?` so the null case is a real comparison: `updated_at` is
  // NOT NULL, so "I read no row" can never match an existing one — which is exactly
  // the intended skip.
  const params: Array<string | null> = [
    stateIdFor(orgId),
    orgId,
    input.plan,
    input.status,
    input.provider ?? null,
    input.providerCustomerId ?? null,
    input.providerSubscriptionId ?? null,
    input.currentPeriodStart ?? null,
    input.currentPeriodEnd ?? null,
    stampedAt,
  ];
  if (cas) params.push(expected);
  const res = db
    .prepare(
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
       updated_at = excluded.updated_at
     ${cas ? "WHERE billing_state.updated_at IS ?" : ""}`
    )
    .run(...params);
  return Number(res.changes) > 0;
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

/** How long a provider event's RAW payload is kept. The row itself is kept FOREVER —
 *  it is the idempotency gate (`billing_events.id` = the provider's global event id),
 *  and deleting it would let a very late redelivery re-apply a plan change or re-grant
 *  a pack. What ages out is `payload_json`: the verbatim webhook body, which carries a
 *  customer id, an email on some Polar shapes, and the whole product/price object. It
 *  answers "what exactly did the provider send us" during an incident, and nobody asks
 *  that of a delivery from last quarter — while every one of them stays on disk in a
 *  table only the provider decides the size of. 90 days spans a monthly billing cycle
 *  plus a full dispute window with room to spare. */
export const BILLING_EVENT_PAYLOAD_RETENTION_DAYS = 90;

/** Blank the raw payloads of provider events older than the retention window, KEEPING
 *  the rows (see the constant above: the row is the idempotency gate, the payload is
 *  the forensic copy). Idempotent — the `payload_json <> ''` predicate means a second
 *  sweep over the same rows changes nothing — and deployment-wide by design: retention
 *  is a property of the deployment's disk, not of one org's subscription. Returns the
 *  number of payloads blanked. */
export function pruneBillingEventPayloads(
  now: Date = new Date(),
  retentionDays: number = BILLING_EVENT_PAYLOAD_RETENTION_DAYS
): number {
  const db = ensureDb();
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const res = db.prepare(`UPDATE billing_events SET payload_json = '' WHERE received_at < ? AND payload_json <> ''`).run(cutoff);
  return Number(res.changes);
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

/** Default page for the alert worklist — an operator triages the newest signals; a
 *  deployment with more open alerts than this has a configuration emergency, not a
 *  paging problem. */
export const BILLING_ALERT_LIST_DEFAULT_LIMIT = 200;
/** Hard ceiling a caller cannot argue past. `billing_alerts` grows from a PROVIDER
 *  event stream (one row per distinct dark subscription/order), so an unbounded
 *  `SELECT … ORDER BY id DESC` with no LIMIT was a table read whose size an external
 *  system decides. */
export const BILLING_ALERT_LIST_MAX_LIMIT = 500;

/** List billing alerts, newest first. Defaults to unresolved only — the "paid but
 *  dark" worklist for an admin surface / health check.
 *  DEPLOYMENT-scoped on purpose (no org filter): this is the operator's cross-
 *  customer worklist, and each row carries its orgId for attribution.
 *
 *  BOUNDED: `limit` is clamped to 1..{@link BILLING_ALERT_LIST_MAX_LIMIT} (a missing,
 *  non-finite or absurd value falls back to the default), so no caller can ask this
 *  for the whole table. */
export function listBillingAlerts(opts: { includeResolved?: boolean; limit?: number } = {}): BillingAlert[] {
  const db = ensureDb();
  const requested = typeof opts.limit === "number" && Number.isFinite(opts.limit) ? Math.trunc(opts.limit) : BILLING_ALERT_LIST_DEFAULT_LIMIT;
  const limit = Math.min(BILLING_ALERT_LIST_MAX_LIMIT, Math.max(1, requested));
  const where = opts.includeResolved ? "" : "WHERE resolved_at IS NULL";
  const rows = db
    .prepare(
      `SELECT id, org_id, kind, detail, provider_ref, created_at, resolved_at FROM billing_alerts ${where} ORDER BY id DESC LIMIT ?`
    )
    .all(limit) as Array<Record<string, unknown>>;
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
