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

/** Attribute each backticked SQL block to the exported function it sits in, so the
 *  guard below can exempt the ONE documented cross-org resolver BY NAME instead of
 *  letting any statement hide behind an `org_id` substring appearing somewhere. */
function sqlByOwner(source: string): Array<{ owner: string; sql: string }> {
  const owners = [...source.matchAll(/export function (\w+)/g)].map((m) => ({ name: m[1], at: m.index }));
  return [...source.matchAll(/`([^`]*)`/g)].map((m) => {
    let owner = "<module>";
    for (const o of owners) {
      if (o.at < m.index) owner = o.name;
      else break;
    }
    return { owner, sql: m[1] };
  });
}

/** org_id must be BOUND, not merely MENTIONED: an `org_id = ?` predicate (reads and
 *  updates) or an INSERT that names org_id in its column list (writes).
 *
 *  This is the whole point of the guard. The previous version asserted `/org_id/` over
 *  the raw statement text, which a `SELECT org_id, plan FROM billing_state WHERE plan = ?`
 *  satisfies while reading EVERY org's rows — the column happens to be in the projection.
 *  A cross-context sweep found six tenancy guards that were weak in exactly this way, so
 *  what is pinned here is the predicate, not the presence of a string. */
function orgBound(sql: string): boolean {
  if (/\borg_id\s*=\s*\?/i.test(sql)) return true;
  const insert = sql.match(/insert\s+into\s+billing_\w+\s*\(([^)]*)\)/i);
  return Boolean(insert && /\borg_id\b/i.test(insert[1]));
}

/** The documented cross-org exception, named so it can never widen silently: the
 *  webhook's org RESOLVER looks a subscription/customer up ACROSS orgs precisely to
 *  find the org to scope everything else to (sync.ts → resolveBillingOrg). */
const ORG_RESOLVERS = new Set(["billingOrgForProviderRefs"]);

test("every SQL on billing_state / billing_credits / billing_usage BINDS org_id", () => {
  const owned = sqlByOwner(src).filter(({ sql }) =>
    /\b(from|into|update|delete\s+from)\s+billing_(state|credits|usage)\b/i.test(sql)
  );
  // A drop below the known statement count means the backtick scan mis-paired (an odd
  // backtick in a comment) and the loop is silently checking nothing.
  assert.ok(owned.length >= 8, `expected >=8 org-scoped billing statements, found ${owned.length}`);
  assert.equal(
    owned.filter(({ owner }) => ORG_RESOLVERS.has(owner)).length,
    2,
    "the org resolver is exactly its two lookups (by subscription, by customer) — a third is a new exemption"
  );
  for (const { owner, sql } of owned) {
    if (ORG_RESOLVERS.has(owner)) continue;
    assert.ok(orgBound(sql), `${owner}: org_id is mentioned but NOT bound:\n${sql.trim().slice(0, 220)}`);
  }
});

test("the guard itself rejects a statement that only MENTIONS org_id", () => {
  // Pin the detector, not just today's source: these are the shapes the old substring
  // test waved through — cross-org reads with org_id in the projection or a comment.
  assert.equal(orgBound("SELECT org_id, plan FROM billing_state WHERE plan = ?"), false);
  assert.equal(orgBound("UPDATE billing_usage SET qty = qty + 1 WHERE meter = ? /* org_id */"), false);
  assert.equal(orgBound("SELECT SUM(delta) FROM billing_credits WHERE meter = ? ORDER BY org_id"), false);
  // …and still accepts the two genuinely-scoped shapes.
  assert.equal(orgBound("SELECT * FROM billing_state WHERE org_id = ?"), true);
  assert.equal(orgBound("INSERT INTO billing_usage (org_id, meter, period, qty) VALUES (?, ?, ?, ?)"), true);
});

test("the exempt cross-org resolver is named and still exists", () => {
  assert.equal(ORG_RESOLVERS.size, 1, "a second exemption needs its own documented rationale above");
  for (const name of ORG_RESOLVERS) {
    assert.match(src, new RegExp(`export function ${name}\\b`), `${name} is gone — the exemption is now dead weight`);
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
