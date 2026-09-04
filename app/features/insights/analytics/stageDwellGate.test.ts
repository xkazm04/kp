// Executing coverage for the dwell band's empty gate and bar scale.
//
// The bar: the band appears when ANY ONE of its three edges has something to report,
// and disappears entirely when none does — a second „nothing yet" under the funnel
// band's own is noise, and a band of empty chrome is worse than no band.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { dwellBandHasContent, dwellBarPct, dwellMaxDays, dwellWaiting, type StageDwell } from "./stageDwellGate";

const stage = (over: Partial<StageDwell> = {}): StageDwell => ({ stage: "screen", avgDays: 6, count: 3, ...over });

test("nothing measured anywhere renders no band", () => {
  assert.equal(dwellBandHasContent([], 0, 0), false);
});

test("any ONE of the three edges earns the band", () => {
  assert.equal(dwellBandHasContent([stage()], 0, 0), true, "people sitting in stages");
  assert.equal(dwellBandHasContent([], 4, 0), true, "KO-gate discards alone are a real finding");
  assert.equal(dwellBandHasContent([], 0, 2), true, "an offer leg alone is a real finding");
});

test("the headline counts everyone waiting, across every stage", () => {
  assert.equal(dwellWaiting([stage({ count: 3 }), stage({ stage: "interview", count: 5 })]), 8);
  assert.equal(dwellWaiting([]), 0);
});

test("bars scale against the longest wait, never against zero", () => {
  assert.equal(dwellMaxDays([]), 1, "an empty list must not produce a 0 divisor");
  assert.equal(dwellMaxDays([stage({ avgDays: 0 })]), 1, "…nor an all-same-day corpus");
  const max = dwellMaxDays([stage({ avgDays: 4 }), stage({ avgDays: 20 })]);
  assert.equal(max, 20);
  assert.equal(dwellBarPct(20, max), 100);
  assert.equal(dwellBarPct(10, max), 50);
});

test("the shortest wait still draws a visible mark", () => {
  assert.equal(dwellBarPct(0, 30), 2, "a zero-width bar reads as a missing row, not as a short one");
  assert.equal(dwellBarPct(0.2, 30), 2);
});

test("the panel reads the gate instead of re-typing it", () => {
  const panel = readFileSync(
    path.join(process.cwd(), "app", "features", "insights", "analytics", "AnalyticsStageDwellPanel.tsx"),
    "utf8"
  ).replace(/\r\n/g, "\n");
  assert.match(panel, /dwellBandHasContent\(/, "the whole-band gate must be executable, not an inline && chain");
  assert.match(panel, /dwellBarPct\(/, "…and so must the bar scale");
});
