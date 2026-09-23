// DAILY SUBSCRIPTION RECONCILE: FLAG A LOST WEBHOOK, NEVER REWRITE STATE
// (challenge-r07 billing-subscriptions/B).
//
// The webhook is the only write path for money state, and it is lossy with no signal: a
// deployment unreachable past the provider's retry window loses the delivery, and a
// CAS-dropped set or revoke answers 2xx so it is never redelivered (sync.ts). This pass
// reads each stored subscription back from the provider and turns a disagreement into
// ONE deduped operator alert (`subscription_drift`). It NEVER writes billing_state: a
// correction from a pull would move an entitlement, which is a different card.
//
// Default OFF. The pass runs only with KP_BILLING_SUBSCRIPTION_RECONCILE=1 (the
// provider GET has not been validated against a live sandbox yet — the README names the
// pass owed before the flag is set), refuses under KP_OFFLINE, and with the flag unset
// fetches nothing and writes nothing. Every fetch here is a stub; no case calls Polar.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../testing/unit-db.ts";

// Metering ON, exactly as the charge-parity golden was captured.
process.env.POLAR_ACCESS_TOKEN = "polar_test_token";

const { ensureDb } = await import("../db/core.ts");
const store = await import("../db/billing.ts");
const alerts = await import("./alerts.ts");
const parity = await import("./__fixtures__/charge-parity-replay.ts");
// The module under test did not exist when these cases were written: read it through a
// computed specifier so this file type-checks on that tree and fails at RUNTIME there.
const RECONCILE_MODULE = "./subscription-reconcile" + ".ts";
const reconcile = (await import(RECONCILE_MODULE).catch(() => ({}))) as Record<string, unknown>;

after(() => cleanupUnitDb());

type Loose = Record<string, unknown>;
const fn = <T>(mod: unknown, name: string): T => {
  const f = (mod as Loose)[name];
  assert.equal(typeof f, "function", `${name} is exported`);
  return f as T;
};

type Stored = { orgId?: string; plan: string; status: string; providerSubscriptionId: string | null; currentPeriodEnd?: string | null };
type Provider = { id?: string | null; status: string; productId: string | null; currentPeriodStart?: string | null; currentPeriodEnd?: string | null };
type Drift = { kind: string; severity: string; subscriptionId: string | null; detail: string };
type ProductMap = Record<string, { kind: "plan"; plan: string } | { kind: "pack"; meter: string; qty: number }>;
type RunResult = { skipped: boolean; checked: number; drifts: number; alerted: number };
type Source = { fetchSubscription(id: string): Promise<unknown | null>; productMap(): ProductMap };

const reconcileSubscriptionState = (s: Stored, p: Provider | null, m: ProductMap): Drift | null =>
  fn<(s: Stored, p: Provider | null, m: ProductMap) => Drift | null>(reconcile, "reconcileSubscriptionState")(s, p, m);
const runSubscriptionReconcile = (source: Source | null, env?: NodeJS.ProcessEnv): Promise<RunResult> =>
  fn<(s: Source | null, e?: NodeJS.ProcessEnv) => Promise<RunResult>>(reconcile, "runSubscriptionReconcile")(source, env);

const STARTER = "prod_starter";
const GROWTH = "prod_growth";
const PRODUCTS: ProductMap = {
  [STARTER]: { kind: "plan", plan: "starter" },
  [GROWTH]: { kind: "plan", plan: "growth" },
  prod_pack: { kind: "pack", meter: "interview_minutes", qty: 100 },
};
const ON = { KP_BILLING_SUBSCRIPTION_RECONCILE: "1" } as unknown as NodeJS.ProcessEnv;
const env = (e: Record<string, string>): NodeJS.ProcessEnv => e as unknown as NodeJS.ProcessEnv;

/** A provider stand-in that records every id it is asked for. */
function stubSource(answer: (id: string) => unknown | null): Source & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    productMap: () => PRODUCTS,
    fetchSubscription: async (id: string) => {
      asked.push(id);
      return answer(id);
    },
  };
}

const driftAlerts = () =>
  ensureDb()
    .prepare(`SELECT org_id, kind, provider_ref, resolved_at FROM billing_alerts WHERE kind = 'subscription_drift' ORDER BY id`)
    .all() as Array<{ org_id: string; kind: string; provider_ref: string; resolved_at: string | null }>;

// The parity fixture is built FIRST, on the fresh DB, because the golden was captured
// on a fresh DB; the pure cases below touch no DB at all.
const fx = parity.chargeParityFixture();

// ---- 1-4. the pure decision --------------------------------------------------------

test("case 1: stored free/none vs provider active on a mapped plan -> missed_activation (error): a paying customer we never entitled", () => {
  const drift = reconcileSubscriptionState(
    { plan: "free", status: "none", providerSubscriptionId: "sub_X" },
    { status: "active", productId: STARTER },
    PRODUCTS
  );
  assert.ok(drift, "a paying subscription we hold as free is drift");
  assert.equal(drift.kind, "missed_activation");
  assert.equal(drift.severity, "error");
  assert.equal(drift.subscriptionId, "sub_X");
});

test("case 2: a missed revoke is drift; the same plan, status and period end (within 1h) is not", () => {
  const revoked = reconcileSubscriptionState(
    { plan: "growth", status: "active", providerSubscriptionId: "sub_C" },
    { status: "revoked", productId: GROWTH },
    PRODUCTS
  );
  assert.equal(revoked?.kind, "missed_revocation");
  assert.equal(revoked?.severity, "error");

  const agreed = reconcileSubscriptionState(
    { plan: "growth", status: "active", providerSubscriptionId: "sub_C", currentPeriodEnd: "2026-09-10T00:00:00.000Z" },
    { id: "sub_C", status: "active", productId: GROWTH, currentPeriodEnd: "2026-09-10T00:30:00.000Z" },
    PRODUCTS
  );
  assert.equal(agreed, null, "agreement within the 1h tolerance is not drift");

  // A revoke we already applied (the free tombstone) agrees with a revoked provider.
  assert.equal(
    reconcileSubscriptionState({ plan: "free", status: "none", providerSubscriptionId: "sub_dead" }, { status: "revoked", productId: STARTER }, PRODUCTS),
    null
  );
});

test("case 3: a renewal we never heard about leaves a stale period end -> missed_renewal", () => {
  const drift = reconcileSubscriptionState(
    { plan: "starter", status: "active", providerSubscriptionId: "sub_A", currentPeriodEnd: "2026-09-01T00:00:00.000Z" },
    { id: "sub_A", status: "active", productId: STARTER, currentPeriodEnd: "2026-10-01T00:00:00.000Z" },
    PRODUCTS
  );
  assert.equal(drift?.kind, "missed_renewal", "the past_due grace would cut from the stale end");
});

test("case 4: an unmapped product is the unmapped_product alert's job, and an unreadable read is no verdict", () => {
  assert.equal(
    reconcileSubscriptionState({ plan: "free", status: "none", providerSubscriptionId: "sub_X" }, { status: "active", productId: "prod_unknown" }, PRODUCTS),
    null,
    "an unmapped product is not subscription drift"
  );
  assert.equal(
    reconcileSubscriptionState({ plan: "starter", status: "active", providerSubscriptionId: "sub_A" }, null, PRODUCTS),
    null,
    "a provider we could not read is unknown, never drift"
  );
  const read = fn<(b: unknown) => Provider | null>(reconcile, "readProviderSubscription");
  assert.equal(read(null), null);
  assert.equal(read("not json"), null);
  assert.equal(read({ id: "sub_A" }), null, "no status, no verdict");
  const parsed = read({ id: "sub_A", status: "active", product: { id: STARTER }, current_period_end: "2026-10-01T00:00:00.000Z" });
  assert.equal(parsed?.status, "active");
  assert.equal(parsed?.productId, STARTER, "the same product_id / product.id reads mapPolarEvent trusts");
  assert.equal(parsed?.currentPeriodEnd, "2026-10-01T00:00:00.000Z");
});

// ---- 7. charge parity (GUARD) — before the other DB cases, on the golden's history --

test("case 7 (GUARD): every stored subscription reported drifted leaves the money tables byte-identical — only billing_alerts grows", async () => {
  const golden = parity.readChargeParityGolden();
  assert.ok(golden, "the committed golden is missing");
  parity.replayChargeParity(fx, parity.CHARGE_PARITY_NOW);
  const before = (ensureDb().prepare(`SELECT COUNT(*) AS n FROM billing_alerts`).get() as { n: number }).n;
  const source = stubSource((id) => ({ id, status: "revoked", product_id: STARTER }));
  const r = await runSubscriptionReconcile(source, ON);
  assert.equal(r.skipped, false);
  assert.ok(r.drifts >= 2, "org A (starter) and org C (growth) both read as revoked");
  const snapshot = JSON.stringify(parity.chargeParitySnapshot(fx, parity.CHARGE_PARITY_NOW), null, 2);
  assert.equal(snapshot, JSON.stringify(golden.replay, null, 2), "the reconcile moved money state");
  const afterCount = (ensureDb().prepare(`SELECT COUNT(*) AS n FROM billing_alerts`).get() as { n: number }).n;
  assert.equal(afterCount - before, r.alerted, "the only write is one alert per drifted subscription");
});

// ---- 6. one deduped operator alert per drifted subscription ------------------------

test("case 6: a drift is ONE alert under the default org with ref sub-drift:<id>; a second run inserts nothing; operator audience only", async () => {
  const rows = driftAlerts();
  assert.deepEqual(rows.map((r) => r.provider_ref).sort(), ["sub-drift:sub_A", "sub-drift:sub_C"]);
  for (const r of rows) assert.equal(r.org_id, "org-default", "a deployment-level fact is stored under the home org, like price_drift");

  const again = await runSubscriptionReconcile(stubSource((id) => ({ id, status: "revoked", product_id: STARTER })), ON);
  assert.equal(again.drifts, rows.length, "the drift is still there");
  assert.equal(again.alerted, 0, "recordBillingAlert dedupes an open alert on its providerRef");
  assert.equal(driftAlerts().length, rows.length);

  assert.equal(alerts.isBillingAlertKind("subscription_drift"), true);
  const stored = store.listBillingAlertsForOrg("org-default").filter((a) => a.kind === "subscription_drift");
  const owner = alerts.billingAlertViews(stored, { homeOrgReader: false });
  assert.equal(owner.length, 0, "an org owner never sees another customer's subscription drift");
  const operator = alerts.billingAlertViews(stored, { homeOrgReader: true });
  assert.equal(operator.length, rows.length);
  assert.ok(operator.every((v) => v.code === "subscription_drift" && v.audience === "operator" && typeof v.detail === "string"));
});

// ---- 5. default off, offline-refused, bounded --------------------------------------

test("case 5: flag unset, KP_OFFLINE, or no provider -> skipped with zero fetches; with the flag it fetches at most the per-run bound", async () => {
  const source = stubSource(() => null);
  assert.deepEqual(await runSubscriptionReconcile(null, ON), { skipped: true, checked: 0, drifts: 0, alerted: 0 });
  assert.deepEqual(await runSubscriptionReconcile(source, env({})), { skipped: true, checked: 0, drifts: 0, alerted: 0 }, "flag unset");
  assert.deepEqual(await runSubscriptionReconcile(source, env({ KP_BILLING_SUBSCRIPTION_RECONCILE: "0" })), { skipped: true, checked: 0, drifts: 0, alerted: 0 });
  assert.deepEqual(await runSubscriptionReconcile(source, env({ KP_BILLING_SUBSCRIPTION_RECONCILE: "1", KP_OFFLINE: "1" })), { skipped: true, checked: 0, drifts: 0, alerted: 0 }, "KP_OFFLINE refuses the fetch");
  assert.equal(source.asked.length, 0, "no skipped run fetches anything");

  const max = reconcile.SUBSCRIPTION_RECONCILE_MAX_PER_RUN as number;
  assert.equal(typeof max, "number");
  for (let i = 0; i < max + 5; i++) {
    store.upsertBillingState({ orgId: `org-bound-${i}`, plan: "starter", status: "active", provider: "polar", providerSubscriptionId: `sub_bound_${i}` });
  }
  const bounded = stubSource(() => null);
  const r = await runSubscriptionReconcile(bounded, ON);
  assert.equal(r.skipped, false);
  assert.equal(bounded.asked.length, max, "one run reads at most the stated bound");
  assert.equal(r.checked, 0, "an unreadable subscription is not counted as checked");
  assert.equal(r.drifts, 0, "an unreadable subscription is never drift");
});

test("case 5b: the clock registers the job only behind the flag — unset leaves no scheduler row and no run", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../instrumentation-node.ts"), "utf8");
  const at = src.indexOf('"subscription_reconcile"');
  assert.ok(at > 0, "the job is registered by the clock");
  const guard = src.lastIndexOf('process.env.KP_BILLING_SUBSCRIPTION_RECONCILE === "1"', at);
  assert.ok(guard > 0 && at - guard < 1200, "the registration sits inside the flag guard");
  const ensure = src.indexOf("ensureSchedule(SUBSCRIPTION_RECONCILE_JOB", at);
  assert.ok(ensure > at, "ensureSchedule runs after the guard, never before it");
});
