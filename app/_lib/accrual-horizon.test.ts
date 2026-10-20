import { test } from "node:test";
import assert from "node:assert/strict";
import { accrualHorizon } from "./accrual-horizon.ts";

// The registry's state-the-accrual-horizon step 5: a refusal names the count needed,
// the current rate of accrual and the resulting date, and says why when there is none.

const NOW = Date.parse("2026-09-23T00:00:00.000Z");
const DAY = 86_400_000;

test("a paced shortfall resolves to a count, a week figure and a date", () => {
  const h = accrualHorizon({ have: 5, need: 8, perWeek: 1.5, windowDays: null, nowMs: NOW });
  assert.deepEqual(h, { more: 3, etaWeeks: 2, etaDate: NOW + 14 * DAY, reason: null });
});

test("no recent pace: the shortfall stands and no date is invented", () => {
  for (const perWeek of [0, null, undefined, -1, Number.NaN]) {
    const h = accrualHorizon({ have: 5, need: 8, perWeek, windowDays: null, nowMs: NOW });
    assert.deepEqual(h, { more: 3, etaWeeks: null, etaDate: null, reason: "no-pace" }, String(perWeek));
  }
});

test("a sliding window too narrow to ever hold the floor at this pace says so", () => {
  // Steady state of a 30-day window at 1/week is 30/7 = 4.3 < 8: it never clears.
  const h = accrualHorizon({ have: 4, need: 8, perWeek: 1, windowDays: 30, nowMs: NOW });
  assert.equal(h.reason, "window-too-narrow");
  assert.equal(h.more, 4);
  assert.equal(h.etaDate, null);
  assert.equal(h.etaWeeks, null);
  // All time, the same pace does clear: 4 more at 1/week.
  const allTime = accrualHorizon({ have: 4, need: 8, perWeek: 1, windowDays: null, nowMs: NOW });
  assert.deepEqual(allTime, { more: 4, etaWeeks: 4, etaDate: NOW + 28 * DAY, reason: null });
  // A wide enough window at the same pace gives a date too (90/7 = 12.9 >= 8).
  assert.equal(accrualHorizon({ have: 4, need: 8, perWeek: 1, windowDays: 90, nowMs: NOW }).reason, null);
});

test("a figure that does not grow with time is not-accruing, never dated", () => {
  const h = accrualHorizon({ have: 2, need: 3, perWeek: 5, windowDays: null, nowMs: NOW, accrues: false });
  assert.deepEqual(h, { more: 1, etaWeeks: null, etaDate: null, reason: "not-accruing" });
});

test("a met floor needs nothing more", () => {
  const h = accrualHorizon({ have: 9, need: 8, perWeek: 0, windowDays: 30, nowMs: NOW });
  assert.deepEqual(h, { more: 0, etaWeeks: 0, etaDate: NOW, reason: null });
});

test("a fractional week rounds UP — a date that arrives early is a promise broken", () => {
  const h = accrualHorizon({ have: 0, need: 8, perWeek: 3, windowDays: null, nowMs: NOW });
  assert.equal(h.etaWeeks, 3);
});
