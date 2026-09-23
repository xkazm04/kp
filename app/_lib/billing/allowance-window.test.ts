// The ALLOWANCE WINDOW a meter is debited against, stated as dates (challenge-r05
// billing-plan-and-spend/B).
//
// `allowanceWindow(now)` is what the Billing tab says when it tells an owner "resets
// 1 Oct". It is only honest if it is the SAME key `recordMeterUsage` debits under —
// `currentPeriod(now)`, a UTC calendar month — so case 1 samples the calendar and
// asserts the identity. The day the allowance is re-keyed onto the subscription anchor
// (.ai/tasks/2026-09-07-allowance-period-anchor.md) this function takes the
// subscription state too, and the display follows from the one function.
//
// Case 8 is a declared GUARD case: the window is a new, additive, display-only key. The
// scripted three-org money history (shared with the billing_alerts reader,
// __fixtures__/charge-parity-replay.ts) must still reproduce the committed golden
// byte-for-byte — tables, pinned overview keys, meterAllowance, the meterGate 402
// probe — and the only key billingOverview gains is `allowanceWindow`. Green before
// on its golden half by design; red before on the new key.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";

// Metering ON, exactly as the golden was captured.
process.env.POLAR_ACCESS_TOKEN = "polar_test_token";

const plans = await import("./plans.ts");
const { billingOverview } = await import("./entitlements.ts");
const parity = await import("./__fixtures__/charge-parity-replay.ts");

after(() => cleanupUnitDb());

type Window = { period: string; start: string; resetsAt: string; asOf: string };
const allowanceWindow = (now: Date): Window =>
  (plans as unknown as { allowanceWindow: (now: Date) => Window }).allowanceWindow(now);

// ---- 1. the window, and that it IS the debit key -----------------------------------

test("allowanceWindow names the month the debit lands in, and when it resets", () => {
  assert.equal(typeof (plans as Record<string, unknown>).allowanceWindow, "function", "plans.ts exports allowanceWindow");
  assert.deepEqual(allowanceWindow(new Date("2026-09-23T10:00:00Z")), {
    period: "2026-09",
    start: "2026-09-01T00:00:00.000Z",
    resetsAt: "2026-10-01T00:00:00.000Z",
    asOf: "2026-09-23T10:00:00.000Z",
  });
  const eoy = allowanceWindow(new Date("2026-12-31T23:59:00Z"));
  assert.equal(eoy.period, "2026-12");
  assert.equal(eoy.resetsAt, "2027-01-01T00:00:00.000Z", "Dec 31 resets at the next Jan 1");
  const leap = allowanceWindow(new Date("2028-02-29T23:59:59.999Z"));
  assert.equal(leap.period, "2028-02");
  assert.equal(leap.resetsAt, "2028-03-01T00:00:00.000Z", "leap February runs to the 29th");
  assert.equal(allowanceWindow(new Date("2028-03-01T00:00:00.000Z")).period, "2028-03", "the reset instant belongs to the NEW window");

  // 400 instants across 2026-2027 plus the leap-Feb 2028 edge: the displayed window is
  // the debit key by construction, and `now` always sits inside [start, resetsAt).
  const from = Date.UTC(2026, 0, 1);
  const to = Date.UTC(2028, 0, 1);
  const instants: Date[] = [];
  for (let i = 0; i < 400; i++) instants.push(new Date(from + Math.floor(((to - from) * i) / 400) + i * 7_919));
  instants.push(new Date("2028-02-28T23:59:59.999Z"), new Date("2028-02-29T12:00:00Z"), new Date("2028-03-01T00:00:00Z"));
  for (const now of instants) {
    const w = allowanceWindow(now);
    assert.equal(w.period, plans.currentPeriod(now), `period mismatch at ${now.toISOString()}`);
    assert.ok(Date.parse(w.start) <= now.getTime() && now.getTime() < Date.parse(w.resetsAt), `now outside its window at ${now.toISOString()}`);
    assert.equal(plans.currentPeriod(new Date(Date.parse(w.resetsAt) - 1)), w.period, "the last millisecond before reset is still this period");
    assert.notEqual(plans.currentPeriod(new Date(w.resetsAt)), w.period, "the reset instant is the next period");
  }
});

// ---- 8. charge parity (GUARD) ------------------------------------------------------

test("charge parity (GUARD): the window is additive and moves no money state", () => {
  const golden = parity.readChargeParityGolden();
  assert.ok(golden, "the committed golden is missing");
  const fx = parity.chargeParityFixture();
  const NOW = parity.CHARGE_PARITY_NOW;

  // Fresh DB: the pinned overview keys match what GET /api/billing answered before
  // any window existed.
  const fresh = billingOverview(NOW, fx.teamA.id) as unknown as Record<string, unknown>;
  const freshPinned = Object.fromEntries(parity.PINNED_OVERVIEW_KEYS.map((k) => [k, fresh[k]]));
  const goldenPinned = Object.fromEntries(parity.PINNED_OVERVIEW_KEYS.map((k) => [k, golden.freshGet[k]]));
  assert.deepEqual(freshPinned, goldenPinned, "a pre-existing billingOverview key moved");

  // The scripted meterAllowance / recordMeterUsage / meterGate history reproduces the
  // golden byte-for-byte: billing_usage and billing_credits rows included.
  parity.replayChargeParity(fx, NOW);
  const snapshot = JSON.stringify(parity.chargeParitySnapshot(fx, NOW), null, 2);
  assert.equal(snapshot, JSON.stringify(golden.replay, null, 2), "the scripted money history no longer reproduces the golden");

  // The ONLY key billingOverview gains is the window, and it is the debit key.
  const usagePeriods = new Set(
    (golden.replay as { billing_usage: Array<{ period: string }> }).billing_usage.map((r) => r.period)
  );
  for (const ws of fx.workspace.values()) {
    const o = billingOverview(NOW, ws) as unknown as Record<string, unknown>;
    assert.deepEqual(Object.keys(o).sort(), [...parity.PINNED_OVERVIEW_KEYS, "allowanceWindow"].sort());
    assert.deepEqual(o.allowanceWindow, allowanceWindow(NOW));
    assert.deepEqual([...usagePeriods], [(o.allowanceWindow as Window).period], "the window shown is the period every debit landed in");
  }
});
