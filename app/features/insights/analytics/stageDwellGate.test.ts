// Executing coverage for the dwell band's empty gate and bar scale.
//
// The bar: the band appears when ANY ONE of its three edges has something to report,
// and disappears entirely when none does — a second „nothing yet" under the funnel
// band's own is noise, and a band of empty chrome is worse than no band.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  cadenceEditable,
  dwellBandHasContent,
  dwellBarPct,
  dwellBoardFilter,
  dwellMaxDays,
  dwellRowModel,
  dwellWaiting,
  type StageDwell,
} from "./stageDwellGate";
import { parseQuicksParam } from "@/app/features/hiring/pipeline/pipelineBoardFilters";
import { BOTTLENECK_MIN_SAMPLE } from "@/app/_lib/analytics-bottleneck";
import { DEFAULT_STAGE_AXIS, type StageDef } from "@/app/_lib/pipeline-stages";

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

// ---- challenge-r05 analytics-metrics/B: the as-of-now dwell rows --------------------
//
// The band states "# candidates are waiting in a stage right now" and now has the
// numbers to back it: the median of the current occupants, the oldest one, and how
// many are past the stage's cadence, judged by the ONE aging clock the board reads.
// These cases pin the pure half: the thin-sample rule, the verdict-only-with-a-goal
// rule, the board link, and which columns carry an editable cadence.
const occupied = (over: Partial<StageDwell> = {}): StageDwell => ({
  stage: "Interview",
  avgDays: 12,
  count: 3,
  medianDays: 3,
  oldestDays: 31,
  pastCadence: 1,
  stalled: 1,
  cadenceDays: 5,
  cadenceSource: "default",
  cadenceEditable: true,
  ...over,
});

test("a stage at the sample floor reports the pair, median and oldest, not the mean", () => {
  const m = dwellRowModel(occupied({ count: BOTTLENECK_MIN_SAMPLE }));
  assert.equal(m.sample, "enough");
  assert.equal(m.medianDays, 3, "the median of 2, 3 and 31");
  assert.equal(m.oldestDays, 31, "the one who never exits is named, not averaged away into 12");
});

test("a thin stage claims no median: only the count and the oldest", () => {
  const m = dwellRowModel(occupied({ count: 2, medianDays: 4, oldestDays: 6 }));
  assert.equal(m.sample, "thin");
  assert.equal(m.medianDays, null, "a median over two people is not a figure the band may print");
  assert.equal(m.oldestDays, 6);
  assert.equal(m.count, 2);
});

test("a verdict colour only where the TEAM set the cadence", () => {
  assert.equal(dwellRowModel(occupied({ cadenceSource: "default", pastCadence: 2 })).tone, "neutral", "a shipped default is a surfacing count, not a verdict");
  assert.equal(dwellRowModel(occupied({ cadenceSource: "team", pastCadence: 2 })).tone, "over");
  assert.equal(dwellRowModel(occupied({ cadenceSource: "team", pastCadence: 0, stalled: 0 })).tone, "within");
});

test("a payload without the new fields degrades to the old neutral row", () => {
  const m = dwellRowModel({ stage: "Screened", avgDays: 4, count: 5 });
  assert.equal(m.tone, "neutral");
  assert.equal(m.link, null);
  assert.equal(m.oldestDays, null);
});

test("the past-cadence count links to exactly those cards on the board", () => {
  const f = dwellBoardFilter("Interview", 2);
  assert.deepEqual(f, { stage: "Interview", quick: "aging" });
  assert.deepEqual([...parseQuicksParam(f!.quick)], ["aging"], "the board's own ?quick= parser accepts it");
  assert.equal(dwellBoardFilter("Interview", 0), null, "nothing past cadence, nothing to open");
  assert.deepEqual(dwellRowModel(occupied({ pastCadence: 2 })).link, { stage: "Interview", quick: "aging" });
});

test("the cadence is editable on every live column except the terminal one", () => {
  for (const s of DEFAULT_STAGE_AXIS) {
    assert.equal(cadenceEditable(s.id, DEFAULT_STAGE_AXIS), s.role !== "terminal", s.id);
  }
  const custom: StageDef[] = [
    { id: "Applied", label: "Applied", role: "entry" },
    { id: "Tech round", label: "Tech round", role: "interview" },
    { id: "Signed", label: "Signed", role: "terminal" },
  ];
  assert.equal(cadenceEditable("Tech round", custom), true, "an added column carries a cadence the moment it exists");
  assert.equal(cadenceEditable("Signed", custom), false, "a renamed terminal column is still terminal");
  assert.equal(cadenceEditable("Interview", custom), false, "a column this board does not draw has nothing to tune");
});

test("bars scale against the oldest waiter when the payload names one", () => {
  assert.equal(dwellMaxDays([occupied({ avgDays: 12, oldestDays: 31 }), occupied({ avgDays: 2, oldestDays: 4 })]), 31);
});
