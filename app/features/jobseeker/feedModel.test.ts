import { test } from "node:test";
import assert from "node:assert/strict";
import { DISMISS_REASONS, isDismissReason } from "@/app/_lib/jobseeker/types";
import { compareSalary, DISMISS_PICKER_REASONS, nearestScanInterval, resolveFeedEmptyState, SCAN_INTERVALS } from "./feedModel";

// The empty-state chain: the FIRST missing link wins, and rows always win over the chain.
test("empty state resolves to the first missing link of the chain", () => {
  const base = { hasProfile: true, enabledSources: 1, hasScanned: true, rows: 0, liveTotal: 0 };
  assert.equal(resolveFeedEmptyState({ ...base, hasProfile: false, enabledSources: 0, hasScanned: false }), "no_profile");
  assert.equal(resolveFeedEmptyState({ ...base, enabledSources: 0, hasScanned: false }), "no_sources");
  assert.equal(resolveFeedEmptyState({ ...base, hasScanned: false }), "no_scan");
  assert.equal(resolveFeedEmptyState({ ...base, liveTotal: 12 }), "below_min");
  assert.equal(resolveFeedEmptyState(base), "nothing_live");
});

test("rows present is `ok` whatever the chain says", () => {
  assert.equal(resolveFeedEmptyState({ hasProfile: false, enabledSources: 0, hasScanned: false, rows: 3, liveTotal: 3 }), "ok");
});

// The dismiss picker offers exactly the wire vocabulary the route validates with.
test("the dismiss picker's reasons are DISMISS_REASONS, in order", () => {
  assert.deepEqual([...DISMISS_PICKER_REASONS], [...DISMISS_REASONS]);
  for (const r of DISMISS_PICKER_REASONS) assert.ok(isDismissReason(r));
  assert.ok(!isDismissReason("vibes"));
});

// Salary comparability: same currency compares, anything else says so, never converts.
test("salary comparison happens only in one currency and one period", () => {
  const floor = { amount: 60_000, currency: "CZK", period: "month" as const };
  const meets = compareSalary({ min: 70_000, max: 90_000, currency: "czk", period: "month" }, floor);
  assert.equal(meets.kind === "compared" && meets.verdict, "meets_floor");
  assert.deepEqual(compareSalary({ min: 40_000, max: 50_000, currency: "CZK", period: "month" }, floor), { kind: "compared", verdict: "below_floor", pct: 20 });
  assert.deepEqual(compareSalary({ min: 50_000, max: 70_000, currency: "CZK", period: "month" }, floor), { kind: "compared", verdict: "spans_floor", pct: 0 });
  assert.deepEqual(compareSalary({ min: 3_000, max: 4_000, currency: "EUR", period: "month" }, floor), { kind: "not_comparable", posting: "EUR/month", floor: "CZK/month" });
  assert.deepEqual(compareSalary({ min: 900_000, max: null, currency: "CZK", period: "year" }, floor), { kind: "not_comparable", posting: "CZK/year", floor: "CZK/month" });
  assert.deepEqual(compareSalary({ min: null, max: null, currency: null, period: null }, floor), { kind: "unstated" });
  assert.deepEqual(compareSalary({ min: 1, max: 2, currency: "CZK", period: "month" }, null), { kind: "no_floor" });
});

test("a stored interval outside the three offered snaps to the nearest for display", () => {
  assert.deepEqual([...SCAN_INTERVALS], [360, 720, 1440]);
  assert.equal(nearestScanInterval(720), 720);
  assert.equal(nearestScanInterval(15), 360);
  assert.equal(nearestScanInterval(1000), 720);
  assert.equal(nearestScanInterval(1200), 1440);
});
