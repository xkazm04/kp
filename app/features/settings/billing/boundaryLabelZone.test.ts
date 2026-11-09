// One billing boundary, one day, wherever the viewer sits.
//
// The plan card labelled the paid-period end with `{ dateStyle: "long" }` and no zone,
// so it drew the boundary in the VIEWER's zone, while the meter row and the spend panel
// labelled the same reset instant in UTC and planDatesView decided "do the two dates
// differ" by UTC day. With an anchored allowance (plans.ts allowanceWindow) the reset
// carries the subscription's own time of day, so for a viewer far enough from UTC the
// card and the row two lines below named different days for one boundary.
//
// Paired measurement, pinned: the same boundaries rendered for the same viewers through
// arm A (the card's old options, i.e. the viewer's zone) and arm B (boundaryDateOptions).
// Predicate: the card's calendar day differs from the meter row's calendar day.
// Runner: Node's built-in test runner with type stripping. npm run test:unit

import { test } from "node:test";
import assert from "node:assert/strict";
import { BOUNDARY_ZONE, boundaryDateOptions, planDatesView } from "./meterForecast.ts";

/** Reset / period-end instants the card shows: anchored anniversaries carry the time of
 *  day the subscription started; the last two are calendar-month fallbacks. */
const BOUNDARIES = [
  "2026-11-15T03:12:00.000Z",
  "2026-11-15T22:40:00.000Z",
  "2026-11-30T12:00:00.000Z",
  "2026-12-31T23:30:00.000Z",
  "2026-11-01T00:00:00.000Z",
  "2026-12-01T00:00:00.000Z",
];
const VIEWERS = ["UTC", "Europe/Prague", "America/Los_Angeles", "Pacific/Auckland", "Asia/Tokyo"];

/** The calendar day a formatter with these options names, for a viewer in `viewerZone`.
 *  An option set with no timeZone falls to the viewer's zone, which is what the browser
 *  does with it. */
function dayNamed(iso: string, opts: Intl.DateTimeFormatOptions, viewerZone: string): string {
  const zone = opts.timeZone ?? viewerZone;
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const ARM_A_CARD: Intl.DateTimeFormatOptions = { dateStyle: "long" }; // HEAD before this change
const METER_ROW_OLD: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", timeZone: "UTC" };

function mismatches(card: Intl.DateTimeFormatOptions, row: Intl.DateTimeFormatOptions): number {
  let n = 0;
  for (const b of BOUNDARIES) for (const v of VIEWERS) if (dayNamed(b, card, v) !== dayNamed(b, row, v)) n += 1;
  return n;
}

test("calibration: the predicate separates a known-bad and a known-good case", () => {
  // 03:12Z on the 15th is the 14th in Los Angeles: the viewer-zone card must disagree.
  assert.notEqual(dayNamed("2026-11-15T03:12:00Z", ARM_A_CARD, "America/Los_Angeles"), dayNamed("2026-11-15T03:12:00Z", METER_ROW_OLD, "America/Los_Angeles"));
  // A UTC viewer cannot see the defect: both arms name the same day.
  assert.equal(dayNamed("2026-11-15T03:12:00Z", ARM_A_CARD, "UTC"), dayNamed("2026-11-15T03:12:00Z", METER_ROW_OLD, "UTC"));
});

test("arm A (viewer zone on the card): 9 of 30 boundary x viewer pairs name two days for one boundary", () => {
  assert.equal(mismatches(ARM_A_CARD, METER_ROW_OLD), 9);
});

test("arm B (one boundary zone everywhere): 0 of 30", () => {
  assert.equal(mismatches(boundaryDateOptions("long"), boundaryDateOptions("short")), 0);
});

test("floor: the meter row's day is unchanged, and planDatesView decides in the zone the labels use", () => {
  for (const b of BOUNDARIES) for (const v of VIEWERS) assert.equal(dayNamed(b, boundaryDateOptions("short"), v), dayNamed(b, METER_ROW_OLD, v));
  assert.equal(BOUNDARY_ZONE, "UTC");
  // Same UTC day, different viewer-local days for an Auckland viewer: one line, not two.
  assert.deepEqual(planDatesView({ paidPeriodEnd: "2026-11-15T03:12:00Z", resetsAt: "2026-11-15T22:40:00Z" }), { diverge: false });
  assert.equal(dayNamed("2026-11-15T03:12:00Z", boundaryDateOptions("long"), "Pacific/Auckland"), dayNamed("2026-11-15T22:40:00Z", boundaryDateOptions("long"), "Pacific/Auckland"));
});
