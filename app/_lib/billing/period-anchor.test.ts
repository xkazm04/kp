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
// THIS TEST DOES NOT ASSERT THAT THE BEHAVIOUR IS CORRECT. It asserts the size of
// the divergence, so the defect is executable rather than remembered: the day the
// allowance is re-keyed to the subscription anchor, `spansTwoAllowanceWindows`
// drops to 0 and this file goes red, which is the signal to delete the pin and
// keep the anchored assertion below it. The plan is
// .ai/tasks/2026-09-07-allowance-period-anchor.md.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit

import { test } from "node:test";
import assert from "node:assert/strict";
import { currentPeriod } from "./plans.ts";

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

/** How many distinct allowance keys `currentPeriod` emits across ONE paid period.
 *  1 is correct — one included allowance per period the customer paid for. */
function allowanceWindowsPerPaidPeriod(anchorISO: string): number {
  const start = new Date(anchorISO);
  const end = addMonthUTC(start);
  const keys = new Set<string>();
  for (let t = new Date(start); t < end; t = new Date(t.getTime() + DAY_MS)) keys.add(currentPeriod(t));
  return keys.size;
}

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

test("MEASURED DIVERGENCE: 9 of 10 anchors receive two allowances per paid period", () => {
  const anchors = [
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
  const spansTwoAllowanceWindows = anchors.filter((d) => allowanceWindowsPerPaidPeriod(`${d}T00:00:00Z`) > 1).length;

  assert.equal(
    spansTwoAllowanceWindows,
    9,
    "If this is now 0 the allowance has been re-keyed to the subscription anchor — " +
      "delete this pin and keep the assertion below. If it moved for any other reason, " +
      "currentPeriod's semantics changed and the plan needs re-measuring.",
  );

  // The one anchor that is already correct, asserted positively so the file still
  // states the intended contract rather than only the deviation from it.
  assert.equal(allowanceWindowsPerPaidPeriod("2026-01-01T00:00:00Z"), 1, "a first-of-month anchor is already aligned");
});
