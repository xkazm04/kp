import { test } from "node:test";
import assert from "node:assert/strict";
import { compareSalary, euresCountries, isNewerThanAnchor, nearestScanInterval, renderedAnchor, SCAN_INTERVALS } from "./feedModel";

// EURES takes location codes; an empty preference list is a query for nothing.
test("EURES countries default to cz and are normalized", () => {
  assert.deepEqual(euresCountries([]), ["cz"]);
  assert.deepEqual(euresCountries(null), ["cz"]);
  assert.deepEqual(euresCountries(undefined), ["cz"]);
  assert.deepEqual(euresCountries(["  "]), ["cz"]);
  assert.deepEqual(euresCountries(["DE", "de", " at "]), ["de", "at"]);
});

// Salary comparability: same currency compares, anything else says so, never converts.
test("salary comparison happens in one currency; month and year are restated by x12", () => {
  const floor = { amount: 60_000, currency: "CZK", period: "month" as const };
  const meets = compareSalary({ min: 70_000, max: 90_000, currency: "czk", period: "month" }, floor);
  assert.equal(meets.kind === "compared" && meets.verdict, "meets_floor");
  assert.deepEqual(compareSalary({ min: 40_000, max: 50_000, currency: "CZK", period: "month" }, floor), { kind: "compared", verdict: "below_floor", pct: 20 , periodConverted: false });
  assert.deepEqual(compareSalary({ min: 50_000, max: 70_000, currency: "CZK", period: "month" }, floor), { kind: "compared", verdict: "spans_floor", pct: 0 , periodConverted: false });
  assert.deepEqual(compareSalary({ min: 3_000, max: 4_000, currency: "EUR", period: "month" }, floor), { kind: "not_comparable", posting: "EUR/month", floor: "CZK/month" });
  const yearly = compareSalary({ min: 900_000, max: null, currency: "CZK", period: "year" }, floor);
  assert.equal(yearly.kind === "compared" && yearly.periodConverted, true, "a yearly posting is restated to the monthly floor by x12");
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

// The last-seen anchor: one comparison over the ordering tuple, and a quiet first run.
test("isNewerThanAnchor compares the (firstSeenAt, id) tuple, and no anchor means nothing is new", () => {
  const anchor = { at: "2026-09-16T10:00:00.000Z", id: "jpo-5" };
  assert.equal(isNewerThanAnchor({ at: "2026-09-16T11:00:00.000Z", id: "jpo-1" }, anchor), true, "a later timestamp wins whatever the id");
  assert.equal(isNewerThanAnchor({ at: "2026-09-16T09:00:00.000Z", id: "jpo-9" }, anchor), false);
  assert.equal(isNewerThanAnchor({ at: anchor.at, id: "jpo-6" }, anchor), true, "the id breaks a tie");
  assert.equal(isNewerThanAnchor({ at: anchor.at, id: "jpo-5" }, anchor), false, "the anchor row itself is not new");
  assert.equal(isNewerThanAnchor({ at: anchor.at, id: "jpo-4" }, anchor), false);
  // First run: no anchor is not "everything is new".
  assert.equal(isNewerThanAnchor({ at: "2026-09-16T11:00:00.000Z", id: "jpo-1" }, null), false);
});

test("renderedAnchor is the newest tuple the page showed, not its first row", () => {
  const rows = [
    { id: "jpo-1", firstSeenAt: "2026-09-16T10:00:00.000Z" },
    { id: "jpo-2", firstSeenAt: "2026-09-16T12:00:00.000Z" },
    { id: "jpo-3", firstSeenAt: "2026-09-16T11:00:00.000Z" },
  ];
  assert.deepEqual(renderedAnchor(rows), { at: "2026-09-16T12:00:00.000Z", id: "jpo-2" }, "the feed sorts by fit, so the newest arrival is not row 0");
  assert.deepEqual(
    renderedAnchor([
      { id: "jpo-a", firstSeenAt: "2026-09-16T12:00:00.000Z" },
      { id: "jpo-b", firstSeenAt: "2026-09-16T12:00:00.000Z" },
    ]),
    { at: "2026-09-16T12:00:00.000Z", id: "jpo-b" },
    "same instant: the larger id wins, exactly as the cursor orders"
  );
  assert.equal(renderedAnchor([]), null, "an empty page advances nothing");
});

test("compareSalary restates a monthly floor against a yearly posting by x12, and refuses an hourly one", () => {
  const floor = { amount: 60_000, currency: "CZK", period: "month" as const };
  const yearly = compareSalary({ min: 600_000, max: 900_000, currency: "CZK", period: "year" }, floor);
  assert.equal(yearly.kind, "compared", "month vs year is comparable by x12");
  if (yearly.kind === "compared") {
    assert.equal(yearly.periodConverted, true);
    assert.notEqual(yearly.verdict, "below_floor", "720k/year covers a 60k/month floor");
  }
  const hourly = compareSalary({ min: 400, max: 500, currency: "CZK", period: "hour" as never }, floor);
  assert.equal(hourly.kind, "not_comparable", "an hourly rate is never restated");
  const eur = compareSalary({ min: 3_000, max: 4_000, currency: "EUR", period: "month" }, floor);
  assert.equal(eur.kind, "not_comparable", "a different currency is never converted");
});
