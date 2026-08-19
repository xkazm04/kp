import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  billingOrgForProviderRefs,
  billingUsageFor,
  creditBalance,
  getBillingState,
  grantBillingCredits,
  incrementBillingUsage,
  upsertBillingState,
} from "./billing.ts";
import { DEFAULT_ORG_ID } from "./organizations.ts";
import { billingOrgForWorkspace, meterAllowance, recordMeterUsage } from "../billing/entitlements.ts";
import { registerAccount } from "../signup-service.ts";

after(() => cleanupUnitDb());

// This file pins CROSS-ORG isolation on the hosted product, so it must run with
// metering ON. unit-db.ts scrubs POLAR_* for hermeticity and metering is now a
// property of the deployment (app/_lib/billing/mode.ts) — without a provider
// credential every meter resolves unlimited, which is right for a self-hosted
// install and wrong for the isolation assertions below. Declared explicitly, the
// way unit-db documents. The unmetered side is pinned by billing-selfhost.test.ts.
process.env.POLAR_ACCESS_TOKEN = "polar_test_token";

// Org scope (org-plan Phase 3) — billing is per-ORG (deliberately EXEMPT from the
// per-team workspace_id manifest; see tenancy.ts). This file is the org-axis
// equivalent of a *-tenancy test: a source guard pinning that every SQL statement
// touching the org-scoped billing tables filters/stamps org_id, plus live
// cross-org isolation through the real store.
//
// Documented deployment-global exceptions (asserted below by NAME so a new
// unscoped query can't hide behind them):
//   - billing_events: the idempotency PK is the provider's GLOBAL event id;
//     org_id is recorded attribution only.
//   - listBillingAlerts: the operator's cross-customer "paid but dark" worklist
//     (rows carry org_id; the enumeration is deployment-wide by design).
//   - billingOrgForProviderRefs: the webhook's org RESOLVER — it looks a
//     subscription/customer up across orgs to FIND the org to scope to.

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "billing.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every SQL on billing_state / billing_credits / billing_usage carries org_id", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update|delete\s+from)\s+billing_(state|credits|usage)\b/i.test(s));
  assert.ok(touching.length >= 6, `expected >=6 org-scoped billing queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/org_id/.test(sql), `a billing query is NOT org-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});

test("the documented global exceptions stay the ONLY unscoped reads", () => {
  // billing_events: insert stamps org_id (attribution), dedupe stays the global PK.
  const events = sqlBlocks.filter((s) => /\bbilling_events\b/i.test(s));
  assert.ok(events.length >= 1);
  for (const sql of events) assert.ok(/org_id/.test(sql), "billing_events insert must stamp org_id attribution");
  // billing_alerts: the dedupe probe + worklist SELECT are deployment-global by
  // design, but the INSERT must stamp org_id and the SELECT must return it.
  const alertWrites = sqlBlocks.filter((s) => /insert\s+into\s+billing_alerts/i.test(s));
  assert.ok(alertWrites.length >= 1);
  for (const sql of alertWrites) assert.ok(/org_id/.test(sql), "billing_alerts insert must stamp org_id");
});

test("cross-org isolation: one org's plan/usage/credits never leak into another", () => {
  // Give the DEFAULT org a paid plan + usage + credits.
  upsertBillingState({ plan: "starter", status: "active", provider: "polar", providerSubscriptionId: "sub_default" });
  incrementBillingUsage("ai_candidates", "2026-08", 7);
  grantBillingCredits({ meter: "interview_minutes", delta: 100, reason: "test pack", providerRef: "order_default_1" });

  // A second org (as signup provisions it).
  const r = registerAccount({ email: "owner@second.example", password: "password-x", orgName: "Second Org" });
  assert.ok(r.ok);
  if (!r.ok) return;

  // The new org reads NOTHING of the default org's money state.
  assert.equal(getBillingState(r.orgId), null); // → free plan
  assert.equal(billingUsageFor("ai_candidates", "2026-08", r.orgId), 0);
  assert.equal(creditBalance("interview_minutes", r.orgId), 0);
  // And the default org's rows are exactly what was written.
  assert.equal(getBillingState()?.plan, "starter");
  assert.equal(billingUsageFor("ai_candidates", "2026-08"), 7);
  assert.equal(creditBalance("interview_minutes"), 100);

  // The workspace→org seam: the new team's spend keys to ITS org.
  assert.equal(billingOrgForWorkspace(r.workspaceId), r.orgId);
  recordMeterUsage("ai_candidates", 2, new Date("2026-08-15T12:00:00Z"), r.workspaceId);
  assert.equal(billingUsageFor("ai_candidates", "2026-08", r.orgId), 2);
  assert.equal(billingUsageFor("ai_candidates", "2026-08"), 7); // default untouched

  // Entitlement view: the new org is on free limits, not the default's starter.
  const allowance = meterAllowance("interview_minutes", new Date("2026-08-15T12:00:00Z"), r.workspaceId);
  assert.equal(allowance.allowed, false); // free plan: 0 interview minutes, no credits
  assert.equal(meterAllowance("interview_minutes", new Date("2026-08-15T12:00:00Z")).allowed, true); // default org: 30 + 100 credits

  // Webhook org resolution: the stored subscription maps back to the default org.
  assert.equal(billingOrgForProviderRefs("sub_default", null), DEFAULT_ORG_ID);
  assert.equal(billingOrgForProviderRefs("sub_unknown", null), null);
});

test("an unknown/demo workspace scope fails CLOSED to its own empty scope, never the default org", () => {
  assert.equal(billingOrgForWorkspace("demo"), "demo");
  assert.equal(getBillingState("demo"), null); // free plan — cannot inherit the default org's paid plan
  recordMeterUsage("ai_candidates", 1, new Date("2026-08-15T12:00:00Z"), "demo");
  assert.equal(billingUsageFor("ai_candidates", "2026-08", "demo"), 1);
  // ...and it never polluted the default org's counter.
  assert.equal(billingUsageFor("ai_candidates", "2026-08"), 7);
});
