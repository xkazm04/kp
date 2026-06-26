// Drives the REAL billing stack — db barrel (billing_* DDL + accessors),
// entitlements math, credit consumption, and webhook ingest via a fake
// gateway — against a throwaway SQLite file, so the money-state machine is
// pinned end-to-end without a provider or network. Mirrors the
// rematch-source.test.ts real-module pattern.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
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

// Throwaway DB BEFORE importing (db-path reads KP_DB_PATH at module load;
// node --test isolates each file in its own process, so this can't leak).
const TMP = path.join(os.tmpdir(), `kp-billing-gate-test-${process.pid}.sqlite`);
process.env.KP_DB_PATH = TMP;

const { getBillingState, upsertBillingState, creditBalance, billingUsageFor, recordBillingAlert, listBillingAlerts } = await import("./db.ts");
const { billingOverview, entitledPlan, meterAllowance, recordMeterUsage } = await import(
  "./billing/entitlements.ts"
);
const { activeJobsGate, meterGate } = await import("./billing/enforce.ts");
const { ingestBillingWebhook } = await import("./billing/sync.ts");
const { currentPeriod } = await import("./billing/plans.ts");

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

// ---- the gate, end to end ----------------------------------------------------

test("a fresh workspace is on the free plan with free limits", () => {
  const overview = billingOverview();
  assert.equal(overview.plan.id, "free");
  const candidates = overview.meters.find((m) => m.meter === "ai_candidates");
  assert.deepEqual(
    { limit: candidates?.limit, used: candidates?.used, remaining: candidates?.remaining },
    { limit: 5, used: 0, remaining: 5 }
  );
  assert.equal(meterAllowance("interview_minutes").allowed, false); // free includes 0 minutes
});

test("usage debits the monthly allowance until it blocks", () => {
  for (let i = 0; i < 5; i++) {
    assert.equal(meterAllowance("ai_candidates").allowed, true);
    recordMeterUsage("ai_candidates");
  }
  assert.equal(billingUsageFor("ai_candidates", currentPeriod()), 5);
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
  assert.deepEqual({ limit: candidates?.limit, remaining: candidates?.remaining }, { limit: 100, remaining: 95 });
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
  // ai_candidates: 5/5 used earlier in this file → hard gate fires.
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

test("activeJobsGate caps free at 1 published job; paid plans are uncapped", () => {
  upsertBillingState({ plan: "free", status: "none", provider: "polar" });
  assert.equal(activeJobsGate(0), null);
  const verdict = activeJobsGate(1);
  assert.equal(verdict?.code, "quota_exceeded");
  assert.equal(verdict?.meter, "active_jobs");
  upsertBillingState({ plan: "growth", status: "active", provider: "polar" });
  assert.equal(activeJobsGate(25), null);
});
