// EVERY METER DEBIT NAMES ITS CAUSE (challenge-r07 billing-subscriptions/A).
//
// billing_usage is a per-month counter — `qty = qty + ?` under (org_id, meter, period) —
// so a debit used to leave no record of what caused it: an owner who sees "35 interview
// minutes used" could not be told which sessions burned them, and a double debit (a
// retried completion, a re-published role) was indistinguishable from two real ones.
// recordMeterUsage now takes an optional `source` ({ kind, ref }) and writes ONE
// billing_usage_journal row per debit in the SAME transaction as the counter increment,
// carrying the qty, its included/credits split and the cause.
//
// The journal is WRITE-ONLY EVIDENCE: no gate, allowance, overview key or charge reads
// it. Case 2 is a declared GUARD — the r05 charge-parity golden must reproduce
// byte-for-byte (green before by design, and it must stay green). Duplicates are
// DETECTED (duplicateUsageSources), never refused: refusing would move money.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../testing/unit-db.ts";

// Metering ON, exactly as the golden was captured.
process.env.POLAR_ACCESS_TOKEN = "polar_test_token";

const { ensureDb } = await import("../db/core.ts");
const store = await import("../db/billing.ts");
const entitlements = await import("./entitlements.ts");
const tenancy = await import("../tenancy.ts");
const { createOrganization } = await import("../db/organizations.ts");
const { createWorkspace } = await import("../db/workspaces.ts");
const parity = await import("./__fixtures__/charge-parity-replay.ts");

after(() => cleanupUnitDb());

// The new surface, read through loose handles so this file type-checks on the tree it
// was written against (before the journal existed) and fails at RUNTIME there.
type Source = { kind: string; ref?: string | null };
type JournalRow = {
  orgId: string;
  meter: string;
  period: string;
  qty: number;
  fromIncluded: number;
  fromCredits: number;
  sourceKind: string;
  sourceRef: string | null;
};
type Loose = Record<string, unknown>;
const fn = <T>(mod: unknown, name: string): T => {
  const f = (mod as Loose)[name];
  assert.equal(typeof f, "function", `${name} is exported`);
  return f as T;
};
const recordMeterUsage = (meter: string, qty: number, now: Date, workspace?: string, source?: Source): void =>
  (entitlements.recordMeterUsage as unknown as (...a: unknown[]) => void)(meter, qty, now, workspace, source);
const listUsageJournalForOrg = (orgId: string, period: string): JournalRow[] =>
  fn<(o: string, p: string) => JournalRow[]>(store, "listUsageJournalForOrg")(orgId, period);
const journalIntegrity = (orgId: string): unknown[] => fn<(o: string) => unknown[]>(store, "journalIntegrity")(orgId);
const duplicateUsageSources = (orgId: string, period: string): unknown[] =>
  fn<(o: string, p: string) => unknown[]>(store, "duplicateUsageSources")(orgId, period);

const NOW = parity.CHARGE_PARITY_NOW;
const PERIOD = "2026-08";
const rawJournal = (orgId: string) =>
  ensureDb()
    .prepare(
      `SELECT org_id, meter, period, qty, from_included, from_credits, source_kind, source_ref FROM billing_usage_journal WHERE org_id = ? ORDER BY id`
    )
    .all(orgId) as Array<Record<string, unknown>>;
const usageRows = (orgId: string) =>
  ensureDb().prepare(`SELECT meter, period, qty FROM billing_usage WHERE org_id = ? ORDER BY meter`).all(orgId) as Array<{
    meter: string;
    period: string;
    qty: number;
  }>;

/** A fresh org on `plan` with `credits` prepaid interview minutes, and its team. */
function freshOrg(label: string, plan: string, credits: number): { orgId: string; ws: string } {
  const orgId = createOrganization(`Journal ${label}`).id;
  const ws = createWorkspace(`Journal team ${label}`, orgId).id;
  if (plan !== "free") {
    store.upsertBillingState({
      orgId,
      plan,
      status: "active",
      provider: "polar",
      providerCustomerId: `cus_${label}`,
      providerSubscriptionId: `sub_${label}`,
      currentPeriodStart: "2026-08-01T00:00:00.000Z",
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    });
  }
  if (credits > 0) {
    store.grantBillingCredits({ orgId, meter: "interview_minutes", delta: credits, reason: "pack minutes_100", providerRef: `order_${label}` });
  }
  return { orgId, ws };
}

// The parity fixture is built FIRST, on the fresh DB, because the golden was captured
// on a fresh DB; every other case below works in its own org.
const fx = parity.chargeParityFixture();

// ---- 2. charge parity (GUARD) ------------------------------------------------------

test("case 2 (GUARD): the journal is additive — the scripted money history reproduces the golden byte-for-byte", () => {
  const golden = parity.readChargeParityGolden();
  assert.ok(golden, "the committed golden is missing");
  parity.replayChargeParity(fx, NOW);
  const snapshot = JSON.stringify(parity.chargeParitySnapshot(fx, NOW), null, 2);
  assert.equal(snapshot, JSON.stringify(golden.replay, null, 2), "the scripted money history no longer reproduces the golden");
  // No overview key appears for the journal: the key set is exactly what r05 left it.
  for (const ws of fx.workspace.values()) {
    const o = entitlements.billingOverview(NOW, ws) as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(o).sort(), [...parity.PINNED_OVERVIEW_KEYS, "allowanceWindow"].sort());
  }
});

// ---- 3. integrity: the journal sums to the counter ---------------------------------

test("case 3: after the replay, SUM(journal.qty) equals billing_usage.qty for every (org, meter, period) — journal-less debits journal as 'unattributed'", () => {
  for (const org of [fx.orgA, fx.orgB, fx.orgC]) {
    assert.ok(usageRows(org).length > 0, `the replay debited ${fx.label(org)}`);
    assert.deepEqual(journalIntegrity(org), [], `${fx.label(org)}'s journal disagrees with its counter`);
    const rows = rawJournal(org);
    assert.equal(rows.length, usageRows(org).length, "one journal row per replay debit");
    for (const r of rows) assert.equal(r.source_kind, "unattributed", "a debit with no source journals as unattributed, never fails");
    for (const r of rows) assert.equal(r.source_ref, null);
  }
});

// ---- 4. the credits half matches the credit ledger ---------------------------------

test("case 4: each journal row's from_credits is the magnitude of the 'consumed' credit delta the same debit wrote", () => {
  const consumed = (org: string) =>
    ensureDb()
      .prepare(`SELECT meter, delta FROM billing_credits WHERE org_id = ? AND reason = 'consumed' ORDER BY id`)
      .all(org) as Array<{ meter: string; delta: number }>;
  // Org A: 30 included then 5 credits.
  const a = rawJournal(fx.orgA).find((r) => r.meter === "interview_minutes");
  assert.ok(a);
  assert.deepEqual([a.qty, a.from_included, a.from_credits], [35, 30, 5]);
  assert.deepEqual(consumed(fx.orgA), [{ meter: "interview_minutes", delta: -5 }]);
  // Org B: free (0 included) and 20 credits for 25 minutes — clamped at the balance.
  const b = rawJournal(fx.orgB).find((r) => r.meter === "interview_minutes");
  assert.ok(b);
  assert.deepEqual([b.qty, b.from_included, b.from_credits], [25, 0, 20]);
  assert.deepEqual(consumed(fx.orgB), [{ meter: "interview_minutes", delta: -20 }]);
  // Every row, every org: the journal's credit total IS the consumed ledger's.
  for (const org of [fx.orgA, fx.orgB, fx.orgC]) {
    const journaled = rawJournal(org).reduce((n, r) => n + Number(r.from_credits), 0);
    const ledger = consumed(org).reduce((n, r) => n - r.delta, 0);
    assert.equal(journaled, ledger, `${fx.label(org)}: journal credits vs consumed ledger`);
  }
});

// ---- 1. one attributed debit, one row ----------------------------------------------

test("case 1: an attributed debit writes exactly one journal row with its split and cause, beside the counter", () => {
  const { orgId, ws } = freshOrg("case1", "starter", 100);
  recordMeterUsage("interview_minutes", 35, NOW, ws, { kind: "interview_session", ref: "sess_1" });
  assert.deepEqual(rawJournal(orgId), [
    {
      org_id: orgId,
      meter: "interview_minutes",
      period: PERIOD,
      qty: 35,
      from_included: 30,
      from_credits: 5,
      source_kind: "interview_session",
      source_ref: "sess_1",
    },
  ]);
  assert.deepEqual(usageRows(orgId), [{ meter: "interview_minutes", period: PERIOD, qty: 35 }]);
  const listed = listUsageJournalForOrg(orgId, PERIOD);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].sourceKind, "interview_session");
  assert.equal(listed[0].sourceRef, "sess_1");
  assert.equal(listed[0].fromIncluded, 30);
  assert.equal(listed[0].fromCredits, 5);
});

// ---- 5. duplicates are detected, never refused -------------------------------------

test("case 5: the same source debited twice counts twice (the charge is unchanged) and is reported as a duplicate", () => {
  const { orgId, ws } = freshOrg("case5", "starter", 0);
  recordMeterUsage("ai_candidates", 1, NOW, ws, { kind: "analysis", ref: "an_1" });
  recordMeterUsage("ai_candidates", 1, NOW, ws, { kind: "analysis", ref: "an_1" });
  recordMeterUsage("ai_candidates", 1, NOW, ws, { kind: "analysis", ref: "an_2" });
  assert.deepEqual(usageRows(orgId), [{ meter: "ai_candidates", period: PERIOD, qty: 3 }], "both debits still count");
  assert.deepEqual(duplicateUsageSources(orgId, PERIOD), [
    { meter: "ai_candidates", source_kind: "analysis", source_ref: "an_1", count: 2 },
  ]);
  assert.deepEqual(journalIntegrity(orgId), []);
  // Unattributed debits have no identity to collide on — they are never "duplicates".
  recordMeterUsage("ai_candidates", 1, NOW, ws);
  recordMeterUsage("ai_candidates", 1, NOW, ws);
  assert.equal(duplicateUsageSources(orgId, PERIOD).length, 1);
});

// ---- 6. a non-debit writes nothing -------------------------------------------------

test("case 6: a zero or negative qty writes neither a counter row nor a journal row", () => {
  const { orgId, ws } = freshOrg("case6", "starter", 100);
  recordMeterUsage("interview_minutes", 0, NOW, ws, { kind: "interview_session", ref: "sess_0" });
  recordMeterUsage("interview_minutes", -3, NOW, ws, { kind: "interview_session", ref: "sess_neg" });
  assert.deepEqual(usageRows(orgId), []);
  assert.deepEqual(rawJournal(orgId), []);
});

// ---- 7. every production debit site names its cause --------------------------------

/** The argument text of every `recordMeterUsage(...)` call in `src` (balanced parens). */
function debitCalls(src: string): string[] {
  const out: string[] = [];
  let at = src.indexOf("recordMeterUsage(");
  while (at >= 0) {
    let depth = 0;
    let i = at + "recordMeterUsage".length;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) break;
    }
    out.push(src.slice(at, i + 1));
    at = src.indexOf("recordMeterUsage(", i);
  }
  return out;
}

test("case 7: each of the 6 production debit sites passes a source whose kind is in USAGE_SOURCE_KINDS", () => {
  const kinds = (entitlements as unknown as Loose).USAGE_SOURCE_KINDS as readonly string[] | undefined;
  assert.ok(Array.isArray(kinds), "USAGE_SOURCE_KINDS is exported");
  assert.ok(kinds.includes("unattributed"));
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const sites: Array<[string, string]> = [
    ["_lib/analyze-run.ts", "analysis"],
    ["api/devcase/lifecycle/route.ts", "devcase_lifecycle"],
    ["api/devcase/lifecycle/[id]/redesign/route.ts", "devcase_redesign"],
    ["api/interview/complete/route.ts", "interview_session"],
    ["api/jobs/[id]/publish/route.ts", "job_post"],
    ["_lib/offer-finalize.ts", "hire"],
  ];
  for (const [file, kind] of sites) {
    const src = readFileSync(path.join(appDir, file), "utf8");
    const calls = debitCalls(src).filter((c) => !/^recordMeterUsage\(\)/.test(c));
    assert.equal(calls.length, 1, `${file}: exactly one debit call`);
    const m = calls[0].match(/\{\s*kind:\s*"(\w+)"/);
    assert.ok(m, `${file}: the debit passes no { kind } source:\n${calls[0]}`);
    assert.equal(m[1], kind, `${file}: source kind`);
    assert.ok(kinds.includes(m[1]), `${file}: ${m[1]} is not in USAGE_SOURCE_KINDS`);
    assert.notEqual(m[1], "unattributed", `${file}: a production site must name a real cause`);
  }
});

// ---- 8. tenancy --------------------------------------------------------------------

test("case 8: one org's journal never lists another's rows; the table is manifested with the billing block", () => {
  const other = listUsageJournalForOrg(fx.orgB, PERIOD);
  assert.ok(other.length > 0, "org B has journal rows of its own");
  for (const r of other) assert.equal(r.orgId, fx.orgB, "an org A row leaked into org B's journal");
  assert.equal(listUsageJournalForOrg("org-nobody", PERIOD).length, 0);
  assert.ok(tenancy.TENANCY_EXEMPT_TABLES.has("billing_usage_journal"), "listed with the org-scoped billing tables");
  assert.equal(tenancy.orgExportClass("billing_usage_journal"), "org", "exported with the org's own money record");
});
