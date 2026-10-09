// The cut-over from the calendar key to the anchored key (ADR 0023): usage already
// debited under 'YYYY-MM' inside the first anchored window is counted, so the re-key
// grants no second allowance; credit-pack debits are never counted as allowance; an org
// with no billing_state row stays on the calendar month.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";

process.env.POLAR_ACCESS_TOKEN = "polar_test_token";

const { ensureDb } = await import("../db/core.ts");
const store = await import("../db/billing.ts");
const { meterOverview, recordMeterUsage } = await import("./entitlements.ts");
const { PLANS } = await import("./plans.ts");

after(() => cleanupUnitDb());

const plan = PLANS.starter;
const limit = plan.limits.interview_minutes as number;

/** A debit the way the pre-re-key code wrote it: calendar counter + journal row. */
function legacyDebit(org: string, qty: number, at: string, fromIncluded = qty): void {
  const period = at.slice(0, 7);
  store.incrementBillingUsage("interview_minutes", period, qty, org);
  store.appendUsageJournal({
    orgId: org, meter: "interview_minutes", period, qty, fromIncluded, fromCredits: qty - fromIncluded,
    sourceKind: "unattributed", sourceRef: null, occurredAt: new Date(at).toISOString(),
  });
}
const used = (org: string, now: string) => meterOverview("interview_minutes", plan, new Date(now), org).used;

test("calendar usage inside the first anchored window is carried, not reset", () => {
  ensureDb();
  const org = "org-carry";
  // Window 2026-09-20 .. 2026-10-20. Debits at 09-05 (before it) and 09-25 / 10-02 (inside).
  legacyDebit(org, 4, "2026-09-05T10:00:00Z");
  legacyDebit(org, 6, "2026-09-25T10:00:00Z");
  legacyDebit(org, 3, "2026-10-02T10:00:00Z");
  assert.equal(used(org, "2026-10-05T00:00:00Z"), 3, "calendar month before the switch");
  store.upsertBillingState({ orgId: org, plan: "starter", status: "active", provider: "polar", currentPeriodStart: "2026-09-20T00:00:00Z", currentPeriodEnd: "2026-10-20T00:00:00Z" });
  assert.equal(used(org, "2026-10-05T00:00:00Z"), 9, "only the debits dated inside the window are counted");
});

test("the switch grants no extra allowance, and a credit-funded debit is not allowance", () => {
  const org = "org-carry-2";
  store.grantBillingCredits({ orgId: org, meter: "interview_minutes", delta: 50, reason: "pack", providerRef: "o1" });
  legacyDebit(org, limit + 5, "2026-09-25T10:00:00Z", limit); // limit from allowance, 5 from credits
  store.upsertBillingState({ orgId: org, plan: "starter", status: "active", provider: "polar", currentPeriodStart: "2026-09-20T00:00:00Z", currentPeriodEnd: "2026-10-20T00:00:00Z" });
  const o = meterOverview("interview_minutes", plan, new Date("2026-09-26T00:00:00Z"), org);
  assert.equal(o.used, limit, "the 5 credit-funded units are not carried");
  assert.equal(Math.max(0, limit - o.used), 0, "allowance is spent: no fresh allowance appears at the switch");
});

test("an org with no billing_state row keeps the calendar month", () => {
  const org = "org-nostate";
  recordMeterUsage("interview_minutes", 1, new Date("2026-09-15T00:00:00Z"));
  const rows = ensureDb().prepare(`SELECT period FROM billing_usage WHERE org_id != ? AND period LIKE '2026-09%'`).all(org) as Array<{ period: string }>;
  assert.ok(rows.some((r) => r.period === "2026-09"), "calendar key written");
});
