// Pins the repo-activity window semantics (idea-889dcaf4) that back the recruiter-facing
// "Active" tile and contribution signals: the two named windows, the inclusive boundary, and
// the deliberate 30-day-per-month approximation. `isWithinMonths` takes an injectable `now`,
// so these assertions are deterministic regardless of the wall clock.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_WINDOW_MONTHS,
  RECENT_WINDOW_MONTHS,
  isWithinMonths,
} from "./repo-activity.ts";

// A fixed reference "now" so every boundary is exact. 2026-06-01T00:00:00Z.
const NOW = Date.parse("2026-06-01T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// The named windows are the documented spec.
// ---------------------------------------------------------------------------

test("window constants are the documented 12 / 3 months", () => {
  assert.equal(ACTIVE_WINDOW_MONTHS, 12);
  assert.equal(RECENT_WINDOW_MONTHS, 3);
});

// ---------------------------------------------------------------------------
// 30-day month approximation: ACTIVE = 360 days, RECENT = 90 days.
// ---------------------------------------------------------------------------

test("a month is 30 days, so ACTIVE spans exactly 360 days", () => {
  // Exactly on the 360-day boundary counts (inclusive); one day older does not.
  assert.equal(isWithinMonths(iso(NOW - 360 * DAY), ACTIVE_WINDOW_MONTHS, NOW), true);
  assert.equal(isWithinMonths(iso(NOW - 361 * DAY), ACTIVE_WINDOW_MONTHS, NOW), false);
});

test("RECENT spans exactly 90 days under the same approximation", () => {
  assert.equal(isWithinMonths(iso(NOW - 90 * DAY), RECENT_WINDOW_MONTHS, NOW), true);
  assert.equal(isWithinMonths(iso(NOW - 91 * DAY), RECENT_WINDOW_MONTHS, NOW), false);
});

// ---------------------------------------------------------------------------
// Boundary + degenerate inputs.
// ---------------------------------------------------------------------------

test("a future or just-now date is within any window", () => {
  assert.equal(isWithinMonths(iso(NOW), RECENT_WINDOW_MONTHS, NOW), true);
  assert.equal(isWithinMonths(iso(NOW + DAY), RECENT_WINDOW_MONTHS, NOW), true);
});

test("a date inside RECENT is also inside the wider ACTIVE window", () => {
  const thirtyDaysAgo = iso(NOW - 30 * DAY);
  assert.equal(isWithinMonths(thirtyDaysAgo, RECENT_WINDOW_MONTHS, NOW), true);
  assert.equal(isWithinMonths(thirtyDaysAgo, ACTIVE_WINDOW_MONTHS, NOW), true);
});

test("a date inside ACTIVE but past RECENT is active-only", () => {
  const sixMonthsAgo = iso(NOW - 180 * DAY); // 180 days > 90, < 360
  assert.equal(isWithinMonths(sixMonthsAgo, ACTIVE_WINDOW_MONTHS, NOW), true);
  assert.equal(isWithinMonths(sixMonthsAgo, RECENT_WINDOW_MONTHS, NOW), false);
});

test("null (a repo with no date) is never within a window", () => {
  assert.equal(isWithinMonths(null, ACTIVE_WINDOW_MONTHS, NOW), false);
  assert.equal(isWithinMonths(null, RECENT_WINDOW_MONTHS, NOW), false);
});

test("an unparseable date string is never within a window", () => {
  assert.equal(isWithinMonths("not-a-date", ACTIVE_WINDOW_MONTHS, NOW), false);
});
