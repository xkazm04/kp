// The scripted three-org money history behind charge-parity.json, shared by every
// GUARD case that has to prove "this change moves no charge":
//   - app/api/billing/billing-alerts-route.test.ts (the billing_alerts reader, r05 A)
//   - app/_lib/billing/allowance-window.test.ts   (the allowance window, r05 B)
//
// TEST-ONLY. Import it AFTER app/_lib/testing/unit-db.ts (isolated throwaway DB) and
// with metering on (POLAR_ACCESS_TOKEN set), exactly as the golden was captured.
// One replay, one snapshot, one golden: a second fixture would be a second opinion
// about what "unchanged" means.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ensureDb } from "../../db/core.ts";
import * as billingStore from "../../db/billing.ts";
import { createOrganization } from "../../db/organizations.ts";
import { createWorkspace, type Workspace } from "../../db/workspaces.ts";
import { billingOverview, meterAllowance, recordMeterUsage } from "../entitlements.ts";
import { meterGate } from "../enforce.ts";
import { METERS, type Meter } from "../plans.ts";

export const CHARGE_PARITY_GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), "charge-parity.json");
export const CHARGE_PARITY_NOW = new Date("2026-08-15T12:00:00.000Z");

export type ChargeParityGolden = { freshGet: Record<string, unknown>; replay: unknown };

export function readChargeParityGolden(): ChargeParityGolden | null {
  try {
    return JSON.parse(readFileSync(CHARGE_PARITY_GOLDEN, "utf8")) as ChargeParityGolden;
  } catch {
    return null; // no golden yet: only KP_WRITE_CHARGE_PARITY=1 may create it
  }
}

export type ChargeParityFixture = {
  orgA: string;
  orgB: string;
  orgC: string;
  teamA: Workspace;
  teamB: Workspace;
  teamC: Workspace;
  /** Random org id -> stable label (org-A / org-B / org-C), so snapshots compare. */
  label: (org: unknown) => string;
  /** Stable label -> the workspace that asks on that org's behalf. */
  workspace: Map<string, string>;
};

/** The three orgs and their teams. Org A is the default (home) org. */
export function chargeParityFixture(): ChargeParityFixture {
  const orgA = "org-default";
  const orgB = createOrganization("Alerts Org B").id;
  const orgC = createOrganization("Alerts Org C").id;
  const teamA = createWorkspace("Alerts team A", orgA);
  const teamB = createWorkspace("Alerts team B", orgB);
  const teamC = createWorkspace("Alerts team C", orgC);
  const labels = new Map<string, string>([
    [orgA, "org-A"],
    [orgB, "org-B"],
    [orgC, "org-C"],
  ]);
  const workspace = new Map<string, string>([
    ["org-A", teamA.id],
    ["org-B", teamB.id],
    ["org-C", teamC.id],
  ]);
  return { orgA, orgB, orgC, teamA, teamB, teamC, label: (org) => labels.get(String(org)) ?? String(org), workspace };
}

/** The scripted money history: org A on starter, org B on free with a PAID-BUT-DARK
 *  subscription (unmapped product), org C on growth. Usage, pack grants and their
 *  debits, provider events — every money table carries rows. */
export function replayChargeParity(fx: ChargeParityFixture, now: Date = CHARGE_PARITY_NOW): void {
  billingStore.upsertBillingState({
    orgId: fx.orgA,
    plan: "starter",
    status: "active",
    provider: "polar",
    providerCustomerId: "cus_A",
    providerSubscriptionId: "sub_A",
    currentPeriodStart: "2026-08-01T00:00:00.000Z",
    currentPeriodEnd: "2026-09-01T00:00:00.000Z",
  });
  billingStore.upsertBillingState({
    orgId: fx.orgC,
    plan: "growth",
    status: "active",
    provider: "polar",
    providerCustomerId: "cus_C",
    providerSubscriptionId: "sub_C",
    currentPeriodStart: "2026-08-10T00:00:00.000Z",
    currentPeriodEnd: "2026-09-10T00:00:00.000Z",
  });
  billingStore.insertBillingEvent("evt_A_1", "subscription.active", '{"id":"evt_A_1"}', fx.orgA);
  billingStore.insertBillingEvent("evt_B_1", "subscription.active", '{"id":"evt_B_1","product":"prod_unmapped"}', fx.orgB);
  billingStore.insertBillingEvent("evt_C_1", "subscription.active", '{"id":"evt_C_1"}', fx.orgC);
  billingStore.insertBillingEvent("evt_A_2", "order.paid", '{"id":"evt_A_2"}', fx.orgA);
  billingStore.grantBillingCredits({ orgId: fx.orgA, meter: "interview_minutes", delta: 100, reason: "pack minutes_100", providerRef: "order_A_1" });
  billingStore.grantBillingCredits({ orgId: fx.orgB, meter: "interview_minutes", delta: 20, reason: "pack minutes_100", providerRef: "order_B_1" });
  // Debits: A burns its 30 included minutes then 5 credits; B has 0 included so its
  // 25 minutes draw the 20 credits dry (clamped) and overrun; C spends hires/posts.
  const ws = (l: string) => fx.workspace.get(l);
  const steps: Array<[Meter, number, string | undefined]> = [
    ["ai_candidates", 7, ws("org-A")],
    ["interview_minutes", 35, ws("org-A")],
    ["ai_candidates", 30, ws("org-B")],
    ["interview_minutes", 25, ws("org-B")],
    ["hires", 1, ws("org-C")],
    ["job_posts", 2, ws("org-C")],
    ["case_designs", 1, ws("org-C")],
  ];
  for (const [meter, qty, workspace] of steps) recordMeterUsage(meter, qty, now, workspace);
  // The alerts the reader will surface and resolve: deployment-level drift (stored
  // under the default org), a dark subscription in A, and B's paid-but-dark one.
  billingStore.recordBillingAlert({ kind: "price_drift", detail: "starter: catalog 490 CZK, provider 520 CZK", providerRef: "prod_starter" });
  billingStore.recordBillingAlert({ orgId: fx.orgA, kind: "unmapped_product", detail: "product prod_legacy not in POLAR_PRODUCT_*", providerRef: "sub_A_old" });
  billingStore.recordBillingAlert({ orgId: fx.orgB, kind: "unmapped_product", detail: "product prod_unmapped not in POLAR_PRODUCT_*", providerRef: "sub_B_dark" });
}

/** The overview keys the golden pins — every key billingOverview answered before any
 *  challenge added one. A new ADDITIVE key is not a charge change and is asserted by
 *  the card that adds it. */
export const PINNED_OVERVIEW_KEYS = ["plan", "status", "periodEnd", "provider", "metered", "meters"] as const;

/** Everything that decides what a tenant is charged, with wall-clock stamps and random
 *  org ids normalized away so the result is byte-comparable across runs. */
export function chargeParitySnapshot(fx: ChargeParityFixture, now: Date = CHARGE_PARITY_NOW): unknown {
  const db = ensureDb();
  const { label } = fx;
  const rows = (sql: string) => db.prepare(sql).all() as Array<Record<string, unknown>>;
  const byLabel = <T extends { org: string }>(xs: T[]) => xs.sort((a, b) => (a.org < b.org ? -1 : a.org > b.org ? 1 : 0));
  const state = byLabel(
    rows(
      `SELECT id, org_id, plan, status, provider, provider_customer_id, provider_subscription_id, current_period_start, current_period_end FROM billing_state`
    ).map(({ id, org_id, ...rest }) => ({ org: label(org_id), id: id === "workspace" ? "workspace" : label(id), ...rest }))
  );
  const events = rows(`SELECT id, org_id, type, payload_json FROM billing_events ORDER BY id`).map(({ org_id, ...rest }) => ({ org: label(org_id), ...rest }));
  const credits = rows(`SELECT org_id, meter, delta, reason, provider_ref FROM billing_credits ORDER BY id`).map(({ org_id, ...rest }) => ({ org: label(org_id), ...rest }));
  const usage = byLabel(
    rows(`SELECT org_id, meter, period, qty FROM billing_usage ORDER BY meter, period`).map(({ org_id, ...rest }) => ({ org: label(org_id), ...rest }))
  );
  const orgs = [...fx.workspace.entries()].map(([org, ws]) => {
    const o = billingOverview(now, ws) as unknown as Record<string, unknown>;
    return {
      org,
      overview: Object.fromEntries(PINNED_OVERVIEW_KEYS.map((k) => [k, o[k]])),
      allowance: Object.fromEntries(METERS.map((m) => [m, meterAllowance(m, now, ws)])),
      gate: meterGate("interview_minutes", { now, workspace: ws }),
    };
  });
  return { billing_state: state, billing_events: events, billing_credits: credits, billing_usage: usage, orgs };
}
