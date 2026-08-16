// Drives the REAL billing stack — db barrel (billing_* DDL + accessors),
// entitlements math, credit consumption, and webhook ingest via a fake
// gateway — against a throwaway SQLite file, so the money-state machine is
// pinned end-to-end without a provider or network. Mirrors the
// rematch-source.test.ts real-module pattern.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// Same minimal hooks as rematch-source.test.ts: "@/*" alias, extensionless TS
// siblings, and JSON-without-attribute imports the bare runner can't resolve.
const ROOT = new URL("../../", import.meta.url).href; // repo root (app/_lib/ -> ../../)
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    // Never rewrite specifiers coming from inside node_modules: converting a
    // CJS-internal require (e.g. better-sqlite3's './database') to a file URL
    // breaks the CJS loader. (rematch-source.test.ts dodges this by accident —
    // its hoisted static better-sqlite3 import loads the CJS tree pre-hooks.)
    const fromOurCode = context.parentURL && !context.parentURL.includes("node_modules");
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href;
    else if ((spec.startsWith("./") || spec.startsWith("../")) && fromOurCode) {
      spec = new URL(spec, context.parentURL!).href;
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts";
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const source = "export default " + fs.readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

// Throwaway DB BEFORE importing anything that touches db-path (DB_PATH is frozen
// from KP_DB_PATH at module-eval time), so this MUST stay the first project import.
//
// It used to be a hand-rolled `os.tmpdir()/kp-billing-gate-test-${process.pid}.sqlite`
// that was never deleted. `--test-isolation=process` gives each FILE a fresh process,
// but the OS RECYCLES pids: a later run drawing a pid this file had used before
// re-opened that run's leftover database and inherited its committed billing state
// (used allowance, granted/refunded packs, ingested webhook ids) — so the stateful
// end-to-end assertions failed intermittently. unit-db.ts is the repo-wide fix for
// exactly this: a mkdtemp'd run directory (unique by construction, never pid-derived),
// a liveness-gated sweep of abandoned dirs, and cleanupUnitDb() to remove our own.
const { cleanupUnitDb } = await import("./testing/unit-db.ts");
after(cleanupUnitDb);

const { getBillingState, upsertBillingState, creditBalance, billingUsageFor, recordBillingAlert, listBillingAlerts } = await import("./db.ts");
const { billingOverview, entitledPlan, hasActiveSubscription, meterAllowance, recordMeterUsage } = await import(
  "./billing/entitlements.ts"
);
const { jobPostGate, meterGate } = await import("./billing/enforce.ts");
const { ingestBillingWebhook } = await import("./billing/sync.ts");
const { currentPeriod, PLANS } = await import("./billing/plans.ts");

import type { BillingEvent, BillingGateway, ProductMap } from "./billing/gateway.ts";

// ---- fake gateway: canned verified events, no HTTP --------------------------

const PRODUCTS: ProductMap = {
  prod_starter: { kind: "plan", plan: "starter" },
  prod_pack: { kind: "pack", meter: "interview_minutes", qty: 100 },
};

function fakeGateway(event: BillingEvent): BillingGateway {
  return {
    provider: "polar",
    productMap: () => PRODUCTS,
    createCheckout: async () => ({ url: "https://example.invalid", providerCheckoutId: null }),
    createPortalSession: async () => ({ url: "https://example.invalid" }),
    verifyWebhook: () => event,
  };
}

function subEvent(id: string, status: string): BillingEvent {
  return {
    id,
    type: "subscription.updated",
    kind: "subscription",
    productId: "prod_starter",
    status,
    customerId: "cus_1",
    subscriptionId: "sub_1",
    orderId: null,
    periodStart: "2026-06-01T00:00:00Z",
    periodEnd: "2026-07-01T00:00:00Z",
    raw: {},
  };
}

function packOrderEvent(id: string, orderId: string): BillingEvent {
  return {
    id,
    type: "order.paid",
    kind: "order",
    productId: "prod_pack",
    status: null,
    customerId: "cus_1",
    subscriptionId: null,
    orderId,
    periodStart: null,
    periodEnd: null,
    raw: {},
  };
}

function packRefundEvent(id: string, orderId: string): BillingEvent {
  return { ...packOrderEvent(id, orderId), type: "order.refunded" };
}

function subEventFor(
  id: string,
  status: string,
  subscriptionId: string,
  periodStart: string,
  periodEnd: string
): BillingEvent {
  return {
    id,
    type: `subscription.${status === "active" ? "active" : "updated"}`,
    kind: "subscription",
    productId: "prod_starter",
    status,
    customerId: "cus_1",
    subscriptionId,
    orderId: null,
    periodStart,
    periodEnd,
    raw: {},
  };
}

// ---- the gate, end to end ----------------------------------------------------

// The numbers come from the CATALOG, not from literals here. These assertions used to
// hardcode 5 / 100 / 400 and broke as a set every time pricing was tuned — which made
// a pricing change look like a regression. What is worth pinning is the BEHAVIOUR: the
// overview reflects the plan, the allowance is consumed, and then it blocks.
const FREE_AI = PLANS.free.limits.ai_candidates as number;

test("a fresh workspace is on the free plan with free limits", () => {
  const overview = billingOverview();
  assert.equal(overview.plan.id, "free");
  const candidates = overview.meters.find((m) => m.meter === "ai_candidates");
  assert.deepEqual(
    { limit: candidates?.limit, used: candidates?.used, remaining: candidates?.remaining },
    { limit: FREE_AI, used: 0, remaining: FREE_AI }
  );
  assert.equal(meterAllowance("interview_minutes").allowed, false); // free includes 0 minutes
});

test("usage debits the monthly allowance until it blocks", () => {
  for (let i = 0; i < FREE_AI; i++) {
    assert.equal(meterAllowance("ai_candidates").allowed, true);
    recordMeterUsage("ai_candidates");
  }
  assert.equal(billingUsageFor("ai_candidates", currentPeriod()), FREE_AI);
  const allowance = meterAllowance("ai_candidates");
  assert.deepEqual({ allowed: allowance.allowed, reason: allowance.reason }, { allowed: false, reason: "limit_reached" });
});

test("a pack order grants credits once — order-id dedupe survives distinct event ids", () => {
  const first = ingestBillingWebhook(fakeGateway(packOrderEvent("evt_1", "order_1")), "{}", {});
  assert.deepEqual({ action: first.action, duplicate: first.duplicate }, { action: "grant_credits", duplicate: false });
  assert.equal(creditBalance("interview_minutes"), 100);

  // Same event id again → idempotency gate.
  const replay = ingestBillingWebhook(fakeGateway(packOrderEvent("evt_1", "order_1")), "{}", {});
  assert.equal(replay.duplicate, true);
  // Same ORDER under a new event id → ledger dedupe.
  const reissued = ingestBillingWebhook(fakeGateway(packOrderEvent("evt_2", "order_1")), "{}", {});
  assert.equal(reissued.duplicate, false);
  assert.equal(creditBalance("interview_minutes"), 100);
});

test("credits open the meter and are consumed after the included allowance", () => {
  assert.equal(meterAllowance("interview_minutes").allowed, true); // free limit 0, credits 100
  recordMeterUsage("interview_minutes", 8); // one 8-minute screen, all from credits
  assert.equal(creditBalance("interview_minutes"), 92);
  assert.equal(billingUsageFor("interview_minutes", currentPeriod()), 8);
});

test("a subscription webhook upgrades the entitled plan and limits", () => {
  const result = ingestBillingWebhook(fakeGateway(subEvent("evt_3", "active")), "{}", {});
  assert.equal(result.action, "set_subscription");
  const overview = billingOverview();
  assert.equal(overview.plan.id, "starter");
  const candidates = overview.meters.find((m) => m.meter === "ai_candidates");
  const starterAi = PLANS.starter.limits.ai_candidates as number;
  assert.deepEqual(
    { limit: candidates?.limit, remaining: candidates?.remaining },
    { limit: starterAi, remaining: starterAi - FREE_AI }
  );
  // 30 included − 8 already used this month + 92 credits
  const minutes = overview.meters.find((m) => m.meter === "interview_minutes");
  assert.equal(minutes?.remaining, 30 - 8 + 92);
});

test("revoked drops to free but keeps the customer id for the portal", () => {
  const result = ingestBillingWebhook(fakeGateway(subEvent("evt_4", "revoked")), "{}", {});
  assert.equal(result.action, "clear_subscription");
  const state = getBillingState();
  assert.equal(state?.plan, "free");
  assert.equal(state?.providerCustomerId, "cus_1");
});

test("canceled stays entitled until period end, then falls to free", () => {
  upsertBillingState({
    plan: "starter",
    status: "canceled",
    provider: "polar",
    currentPeriodEnd: "2026-07-01T00:00:00Z",
  });
  assert.equal(entitledPlan(getBillingState(), new Date("2026-06-15T00:00:00Z")).id, "starter");
  assert.equal(entitledPlan(getBillingState(), new Date("2026-07-02T00:00:00Z")).id, "free");
});

test("canceled with an unparseable period end keeps the plan (don't cut a paying customer on a data gap)", () => {
  // A malformed/missing currentPeriodEnd on a cancel must NOT silently drop the
  // customer to free immediately — a genuinely-lapsed sub arrives as revoked instead.
  upsertBillingState({ plan: "growth", status: "canceled", provider: "polar", currentPeriodEnd: "not-a-date" });
  assert.equal(entitledPlan(getBillingState(), new Date("2026-06-15T00:00:00Z")).id, "growth");
  // But a PARSEABLE past end still lapses to free (the grace genuinely expired).
  upsertBillingState({ plan: "growth", status: "canceled", provider: "polar", currentPeriodEnd: "2026-01-01T00:00:00Z" });
  assert.equal(entitledPlan(getBillingState(), new Date("2026-06-15T00:00:00Z")).id, "free");
});

test("meterGate verdicts: exhausted allowance blocks, credits keep a meter open", () => {
  upsertBillingState({ plan: "free", status: "none", provider: "polar" });
  // ai_candidates: the free allowance was fully consumed earlier in this file → hard gate fires.
  const verdict = meterGate("ai_candidates");
  assert.equal(verdict?.code, "quota_exceeded");
  assert.equal(verdict?.meter, "ai_candidates");
  assert.equal(verdict?.plan, "free");
  // interview_minutes: free includes 0, but the pack balance keeps it open.
  assert.equal(meterGate("interview_minutes"), null);
});

test("meterGate minUnits requires the whole action to fit, not just any remaining", () => {
  upsertBillingState({ plan: "free", status: "none", provider: "polar" });
  // The meter is open for a single unit (a sliver of pack balance)...
  assert.equal(meterGate("interview_minutes", { minUnits: 1 }), null);
  // ...but a booked action needing more than the balance must 402, so one leftover
  // minute can't unlock a full interview.
  assert.equal(meterGate("interview_minutes", { minUnits: 1_000_000 })?.code, "quota_exceeded");
});

test("billing alerts: a paid-but-unmapped event is recorded as a queryable worklist row", () => {
  const before = listBillingAlerts().length;
  const inserted = recordBillingAlert({ kind: "unmapped_product", detail: "subscription event for unmapped product prod_x" });
  assert.equal(inserted, true);
  const open = listBillingAlerts();
  assert.equal(open.length, before + 1);
  assert.equal(open[0].kind, "unmapped_product");
  assert.ok(open[0].detail.includes("prod_x"));
  // A redelivery with the same providerRef doesn't pile up a duplicate OPEN alert.
  recordBillingAlert({ kind: "unmapped_product", detail: "again", providerRef: "ref_1" });
  const n = listBillingAlerts().length;
  assert.equal(recordBillingAlert({ kind: "unmapped_product", detail: "again", providerRef: "ref_1" }), false);
  assert.equal(listBillingAlerts().length, n);
});

// Replaces the old activeJobsGate test DELIBERATELY, not incidentally. That gate was a
// CONCURRENCY cap ("how many roles may be open at once") counted per WORKSPACE while
// reading an ORG plan — so a five-team org silently got five times the free allowance.
// Taking a role to market is now a metered unit like any other: counted per org, per
// month, and consumed rather than occupied.
test("jobPostGate meters published roles per org, and paid plans get their allowance", () => {
  upsertBillingState({ plan: "free", status: "none", provider: "polar" });
  assert.equal(jobPostGate(), null, "the free plan's first role publishes");
  recordMeterUsage("job_posts", 1);
  const verdict = jobPostGate();
  assert.equal(verdict?.code, "quota_exceeded", "…and the second is refused");
  assert.equal(verdict?.meter, "job_posts", "the verdict names the meter, not a cap");

  upsertBillingState({ plan: "growth", status: "active", provider: "polar" });
  assert.equal(jobPostGate(), null, "upgrading restores headroom against the same usage");
});

// The hire meter is the other half of the outcome model, and its contract is the
// OPPOSITE: it debits without a gate. A candidate accepting an offer must never fail
// because the recruiter's org is over its allowance, so overage is billed, not blocked.
test("hires debit past the included allowance rather than refusing", () => {
  upsertBillingState({ plan: "free", status: "none", provider: "polar" });
  const period = currentPeriod(new Date());
  const before = billingUsageFor("hires", period);
  recordMeterUsage("hires", 1);
  recordMeterUsage("hires", 1); // free includes 1 — the second is overage
  assert.equal(billingUsageFor("hires", period), before + 2, "both hires are recorded, neither is refused");
  assert.equal(meterAllowance("hires", new Date()).allowed, false, "…and Billing can see the org is over");
});

// ---- finding #2: failed-payment statuses are bounded, not entitled forever -----

test("past_due keeps the plan through a bounded grace, then falls to free", () => {
  upsertBillingState({ plan: "growth", status: "past_due", provider: "polar", currentPeriodEnd: "2026-07-01T00:00:00Z" });
  // within the 7-day grace after period end → still entitled
  assert.equal(entitledPlan(getBillingState(), new Date("2026-07-05T00:00:00Z")).id, "growth");
  // beyond the grace → free (was UNBOUNDED before the fix)
  assert.equal(entitledPlan(getBillingState(), new Date("2026-07-20T00:00:00Z")).id, "free");
});

test("unpaid is bounded by the same grace and FAILS CLOSED without a period anchor", () => {
  upsertBillingState({ plan: "growth", status: "unpaid", provider: "polar", currentPeriodEnd: "2026-07-01T00:00:00Z" });
  // within grace → entitled (was a silent no-op → free before the fix)
  assert.equal(entitledPlan(getBillingState(), new Date("2026-07-05T00:00:00Z")).id, "growth");
  assert.equal(entitledPlan(getBillingState(), new Date("2026-07-20T00:00:00Z")).id, "free");
  // no paid-through anchor on a FAILED payment → free (don't leak an unbounded plan)
  upsertBillingState({ plan: "growth", status: "unpaid", provider: "polar", currentPeriodEnd: null });
  assert.equal(entitledPlan(getBillingState()).id, "free");
});

// ---- finding #4: server-side "already subscribed" gate (pure decision) ---------

test("hasActiveSubscription gates a fresh plan checkout to non-subscribers only", () => {
  upsertBillingState({ plan: "starter", status: "active", provider: "polar" });
  assert.equal(hasActiveSubscription(getBillingState()), true);
  upsertBillingState({ plan: "growth", status: "past_due", provider: "polar" });
  assert.equal(hasActiveSubscription(getBillingState()), true); // failed-payment sub still exists at the MoR
  upsertBillingState({ plan: "starter", status: "canceled", provider: "polar" });
  assert.equal(hasActiveSubscription(getBillingState()), true); // cancel-at-period-end still bills
  upsertBillingState({ plan: "free", status: "none", provider: "polar" });
  assert.equal(hasActiveSubscription(getBillingState()), false); // never/no-longer subscribed → checkout ok
  assert.equal(hasActiveSubscription(null), false);
});

// ---- finding #3: a reordered active after a revoke must NOT re-entitle -----------

test("a reordered active after a revoke does NOT re-entitle the canceled customer", () => {
  // Fresh subscription goes active → starter.
  ingestBillingWebhook(fakeGateway(subEventFor("evt_ro1", "active", "sub_reorder", "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z")), "{}", {});
  assert.equal(billingOverview().plan.id, "starter");
  // Terminal revoke lands FIRST → clear to free (the sub id is kept as a tombstone).
  ingestBillingWebhook(fakeGateway(subEventFor("evt_ro2", "revoked", "sub_reorder", "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z")), "{}", {});
  assert.equal(getBillingState()?.plan, "free");
  // A delayed pre-revoke active for the SAME sub lands SECOND → must stay free.
  const late = ingestBillingWebhook(fakeGateway(subEventFor("evt_ro3", "active", "sub_reorder", "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z")), "{}", {});
  assert.match(late.detail ?? "", /stale re-entitlement/);
  assert.equal(getBillingState()?.plan, "free");
  assert.equal(billingOverview().plan.id, "free");
  // A GENUINE re-subscribe under a NEW sub id is still honored.
  ingestBillingWebhook(fakeGateway(subEventFor("evt_ro4", "active", "sub_new", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z")), "{}", {});
  assert.equal(billingOverview().plan.id, "starter");
});

// ---- finding #1: refunds claw back the granted pack credits ---------------------

test("a refunded pack claws the granted credits back, idempotently", () => {
  const before = creditBalance("interview_minutes");
  const grant = ingestBillingWebhook(fakeGateway(packOrderEvent("evt_rf1", "order_rf")), "{}", {});
  assert.equal(grant.action, "grant_credits");
  assert.equal(creditBalance("interview_minutes"), before + 100);
  // Refund the SAME order → a compensating −100 debit brings it back.
  const refund = ingestBillingWebhook(fakeGateway(packRefundEvent("evt_rf2", "order_rf")), "{}", {});
  assert.equal(refund.action, "grant_credits");
  assert.equal(creditBalance("interview_minutes"), before);
  // A replayed refund (new event id, same order) must NOT double-revoke.
  ingestBillingWebhook(fakeGateway(packRefundEvent("evt_rf3", "order_rf")), "{}", {});
  assert.equal(creditBalance("interview_minutes"), before);
});

test("a refund past already-spent minutes floors the shown balance at 0 (ledger stays truthful)", () => {
  upsertBillingState({ plan: "free", status: "none", provider: "polar" }); // interview_minutes included = 0
  ingestBillingWebhook(fakeGateway(packOrderEvent("evt_cl1", "order_clamp")), "{}", {}); // +100
  // Spend the entire balance (the debit clamps to the live balance → raw balance 0).
  recordMeterUsage("interview_minutes", 1_000_000);
  assert.equal(creditBalance("interview_minutes"), 0);
  // Refund the pack → the ledger goes negative (an honest audit record)...
  ingestBillingWebhook(fakeGateway(packRefundEvent("evt_cl2", "order_clamp")), "{}", {}); // −100
  assert.ok(creditBalance("interview_minutes") < 0);
  // ...but the DISPLAYED / spendable balance is floored at 0, never negative.
  const minutes = billingOverview().meters.find((m) => m.meter === "interview_minutes");
  assert.equal(minutes?.credits, 0);
  assert.equal(minutes?.remaining, 0);
});
