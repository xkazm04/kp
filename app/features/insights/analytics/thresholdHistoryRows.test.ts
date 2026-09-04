// Executing coverage for the floor-history row model.
//
// The bar: an UNKNOWN floor is a dash, never a zero. The strip's own plot already
// skipped null points, while the sentence beside it — and the sr-only list that is
// the entire non-visual rendering of that plot — printed `0`, so the first apply in
// a workspace's history announced a prior floor of 0 that no seal ever recorded.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  chronological,
  floorLabel,
  historyRowValues,
  stripDate,
  UNKNOWN_FLOOR,
  type ThresholdHistoryPoint,
} from "./thresholdHistoryRows";

const point = (over: Partial<ThresholdHistoryPoint> = {}): ThresholdHistoryPoint => ({
  seq: 4,
  contentHash: "abc123def456",
  at: "2026-08-14T09:31:00.000Z",
  approvedBy: "kat",
  direction: "raise",
  previous: 35,
  next: 40,
  band: { lo: 30, hi: 40 },
  n: 22,
  advanceRatePct: 18,
  roleFamily: "backend",
  ...over,
});

test("an unknown floor is a dash, not a zero", () => {
  assert.equal(floorLabel(null), UNKNOWN_FLOOR);
  assert.equal(historyRowValues(point({ previous: null })).previous, UNKNOWN_FLOOR);
  assert.equal(historyRowValues(point({ next: null })).next, UNKNOWN_FLOOR);
});

test("zero is a REAL floor and keeps printing as zero", () => {
  // Accept-everything is a floor a recruiter can legitimately set, so the fix cannot
  // be "falsy → dash": that is the same collapse in the other direction.
  assert.equal(floorLabel(0), 0);
  assert.equal(historyRowValues(point({ previous: 0, next: 45 })).previous, 0);
});

test("a known floor is passed through untouched", () => {
  const values = historyRowValues(point());
  assert.deepEqual(values, { previous: 35, next: 40, at: "2026-08-14" });
});

test("the date is the ISO day, and a shorter string survives", () => {
  assert.equal(stripDate("2026-08-14T09:31:00.000Z"), "2026-08-14");
  assert.equal(stripDate("2026-08"), "2026-08");
});

test("chronological reverses the store order without mutating it", () => {
  const newestFirst = [point({ seq: 3 }), point({ seq: 2 }), point({ seq: 1 })];
  assert.deepEqual(chronological(newestFirst).map((p) => p.seq), [1, 2, 3]);
  assert.deepEqual(newestFirst.map((p) => p.seq), [3, 2, 1], "the record list renders the same array newest-first");
});

test("the strip renders the mapper's values and aborts its fetch on unmount", () => {
  const strip = readFileSync(
    path.join(process.cwd(), "app", "features", "insights", "analytics", "AnalyticsThresholdHistoryStrip.tsx"),
    "utf8"
  ).replace(/\r\n/g, "\n");
  assert.doesNotMatch(strip, /\?\?\s*0/, "a fabricated zero floor is the defect this module exists to end");
  assert.match(strip, /historyRowValues\(/, "the sentence and the sr-only list both read the mapper");
  assert.match(strip, /new AbortController\(\)/, "the fetch is aborted on unmount, not merely ignored by an `alive` flag");
  assert.match(strip, /signal:\s*controller\.signal/, "…and the signal is actually passed to fetch");
});
