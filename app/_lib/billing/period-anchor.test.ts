// The allowance window versus the PAID window — a measured divergence, pinned.
//
// KP keys the monthly allowance ledger on `currentPeriod(now)` — a UTC CALENDAR
// month, "YYYY-MM" (plans.ts). The money is not charged on that boundary: the
// provider bills on the subscription's own anniversary, and KP already stores
// those two dates on the billing_state row as `currentPeriodStart` /
// `currentPeriodEnd` (db/billing.ts) — it simply never keys the allowance by them.
//
// The two windows therefore coincide only for a subscription anchored on the 1st.
// For every other anchor, ONE paid period straddles a calendar boundary and the
// customer is granted TWO monthly allowances inside the single period they paid
// for. Measured below: 9 of 10 representative anchors over-grant.
//
// That direction matters. The registry's plan-entitlements golden path states the
// asymmetry plainly — "A gate that under-grants generates support tickets; a gate
// that over-grants generates revenue that was never collected and a pricing page
// that lies. Both are defects; only one is visible." This is the invisible one.
//
// The allowance is keyed on the subscription anchor (allowancePeriod, plans.ts), so one
// paid period holds exactly one allowance window for every anchor. The plan and the
// decision: .ai/tasks/2026-09-07-allowance-period-anchor.md, ADR 0023.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit

import { test } from "node:test";
import assert from "node:assert/strict";
import { allowancePeriod, allowanceWindow, currentPeriod } from "./plans.ts";

const DAY_MS = 86_400_000;

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** The paid period's end: one month after the anchor, with the day-of-month
 *  clamped to the target month's length (an anchor on the 31st recurs on the 28th
 *  in February). */
function addMonthUTC(d: Date): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, Math.min(d.getUTCDate(), daysInMonth(y, m + 1)), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
}

/** How many distinct allowance keys a keying function emits across ONE paid period.
 *  1 is correct — one included allowance per period the customer paid for. */
function windowsPerPaidPeriod(anchorISO: string, key: (t: Date) => string): number {
  const start = new Date(anchorISO);
  const end = addMonthUTC(start);
  const keys = new Set<string>();
  for (let t = new Date(start); t < end; t = new Date(t.getTime() + DAY_MS)) keys.add(key(t));
  return keys.size;
}
/** The calendar key (what an org with no billing_state row still uses). */
const allowanceWindowsPerPaidPeriod = (anchorISO: string) => windowsPerPaidPeriod(anchorISO, currentPeriod);
/** The anchored key, for a subscription whose current period began at `anchorISO`. */
const anchoredWindowsPerPaidPeriod = (anchorISO: string) =>
  windowsPerPaidPeriod(anchorISO, (t) => allowancePeriod({ currentPeriodStart: anchorISO }, t));

test("currentPeriod is a UTC calendar-month key, independent of any subscription", () => {
  assert.equal(currentPeriod(new Date("2026-01-01T00:00:00Z")), "2026-01");
  assert.equal(currentPeriod(new Date("2026-01-31T23:59:59Z")), "2026-01");
  assert.equal(currentPeriod(new Date("2026-02-01T00:00:00Z")), "2026-02", "the key rolls at the calendar boundary");
  // Same instant, two subscriptions anchored on different days -> the SAME key.
  // That is the property that makes the allowance window unable to track the paid one.
  assert.equal(currentPeriod(new Date("2026-06-15T12:00:00Z")), currentPeriod(new Date("2026-06-15T12:00:00Z")));
});

test("the calibration cases the measurement below must separate", () => {
  // Known-good: anchored on the 1st, the calendar month IS the paid period.
  assert.equal(allowanceWindowsPerPaidPeriod("2026-03-01T00:00:00Z"), 1);
  // Known-bad: anchored mid-month, the paid period straddles a calendar boundary.
  assert.equal(allowanceWindowsPerPaidPeriod("2026-01-20T00:00:00Z"), 2);
});

const ANCHORS = [
  "2026-01-01", // the only anchor where the two windows coincide
  "2026-01-05",
  "2026-01-12",
  "2026-01-15",
  "2026-01-20",
  "2026-01-28",
  "2026-01-31", // month-end: the clamped case
  "2026-02-14",
  "2026-06-30",
  "2026-11-15",
];

test("the calendar key still over-grants on 9 of 10 anchors (why the anchored key exists)", () => {
  assert.equal(ANCHORS.filter((d) => allowanceWindowsPerPaidPeriod(`${d}T00:00:00Z`) > 1).length, 9);
});

test("anchored key: 0 of 10 anchors receive more than one allowance per paid period", () => {
  const over = ANCHORS.filter((d) => anchoredWindowsPerPaidPeriod(`${d}T00:00:00Z`) !== 1);
  assert.deepEqual(over, [], "an anchor received a split or doubled allowance");
});

test("a 01-31 anchor clamps to the month's length and never drifts to the 1st", () => {
  const st = { currentPeriodStart: "2026-01-31T00:00:00Z" };
  assert.equal(allowancePeriod(st, new Date("2026-02-27T23:59:59Z")), "2026-01-31");
  assert.equal(allowancePeriod(st, new Date("2026-02-28T00:00:00Z")), "2026-02-28", "February's anniversary is the 28th");
  assert.equal(allowancePeriod(st, new Date("2026-03-30T23:59:59Z")), "2026-02-28");
  assert.equal(allowancePeriod(st, new Date("2026-03-31T00:00:00Z")), "2026-03-31", "March is back on the 31st");
  assert.equal(allowancePeriod(st, new Date("2026-04-30T00:00:00Z")), "2026-04-30");
  const leap = { currentPeriodStart: "2028-01-31T00:00:00Z" };
  assert.equal(allowancePeriod(leap, new Date("2028-02-29T00:00:00Z")), "2028-02-29");
  const w = allowanceWindow(new Date("2026-02-10T00:00:00Z"), st);
  assert.deepEqual([w.period, w.start, w.resetsAt], ["2026-01-31", "2026-01-31T00:00:00.000Z", "2026-02-28T00:00:00.000Z"]);
});

test("the anchored key never collides with a calendar key; no anchor falls back to the calendar", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  assert.match(allowancePeriod({ currentPeriodStart: "2026-06-01T00:00:00Z" }, now), /^\d{4}-\d{2}-\d{2}$/);
  for (const st of [null, { currentPeriodStart: null }, { currentPeriodStart: "garbage" }, { currentPeriodStart: "2026-07-01T00:00:00Z" }]) {
    assert.equal(allowancePeriod(st, now), currentPeriod(now));
  }
  assert.deepEqual(allowanceWindow(now, null), allowanceWindow(now));
});
