import { test } from "node:test";
import assert from "node:assert/strict";
import { periodDeltas, MIN_RATE_DELTA_N } from "./analytics-deltas.ts";

const slice = (
  total: number,
  hired: number,
  avgTimeToHireDays: number | null,
  funnel: { stage: string; conversionPct: number | null }[] = [],
  bySource: { source: string; total: number; hireRatePct: number }[] = [],
  byChannel: { channel: string; total: number; hireRatePct: number; costPerApplicantCzk: number | null }[] = []
) => ({ total, hired, avgTimeToHireDays, funnel, bySource, byChannel });

test("counts and hire-rate diff current minus prior", () => {
  const d = periodDeltas(slice(50, 9, 20), slice(40, 6, 24));
  assert.deepEqual(d.total, { current: 50, prior: 40, delta: 10 });
  assert.deepEqual(d.hired, { current: 9, prior: 6, delta: 3 });
  // 18% vs 15% → +3 pts
  assert.deepEqual(d.hireRatePct, { current: 18, prior: 15, delta: 3 });
  // time-to-hire improved (lower) — delta is negative, direction is the UI's job
  assert.deepEqual(d.avgTimeToHireDays, { current: 20, prior: 24, delta: -4 });
});

test("an empty cohort yields a null hire rate (undefined, not 0%)", () => {
  const d = periodDeltas(slice(0, 0, null), slice(10, 2, 30));
  assert.deepEqual(d.hireRatePct, { current: null, prior: 20, delta: null });
  assert.equal(d.avgTimeToHireDays.delta, null); // current null → no baseline
});

test("funnel conversion deltas match by stage name, not index", () => {
  const cur = slice(20, 3, 18, [
    { stage: "Accepted", conversionPct: null },
    { stage: "Screened", conversionPct: 60 },
    { stage: "Interview", conversionPct: 40 },
  ]);
  // Prior has the stages in a different order + one missing.
  const prior = slice(15, 2, 22, [
    { stage: "Interview", conversionPct: 30 },
    { stage: "Screened", conversionPct: 50 },
  ]);
  const d = periodDeltas(cur, prior);
  const byStage = Object.fromEntries(d.funnel.map((f) => [f.stage, f.conversionPct]));
  assert.equal(byStage.Screened.delta, 10); // 60 - 50
  assert.equal(byStage.Interview.delta, 10); // 40 - 30, matched by name despite order
  assert.deepEqual(byStage.Accepted, { current: null, prior: null, delta: null });
});

test("a stage absent from the prior window has no baseline", () => {
  const cur = slice(10, 1, 12, [{ stage: "Offer", conversionPct: 75 }]);
  const prior = slice(8, 0, null, []);
  const d = periodDeltas(cur, prior);
  assert.deepEqual(d.funnel[0].conversionPct, { current: 75, prior: null, delta: null });
});

test("per-source volume diffs by name; a source new this window baselines at 0", () => {
  const cur = slice(30, 5, 18, [], [
    { source: "applied", total: 20, hireRatePct: 25 },
    { source: "matched", total: 10, hireRatePct: 10 },
  ]);
  const prior = slice(20, 3, 20, [], [{ source: "applied", total: 12, hireRatePct: 17 }]);
  const d = periodDeltas(cur, prior);
  const bySource = Object.fromEntries(d.bySource.map((r) => [r.source, r]));
  assert.deepEqual(bySource.applied.volume, { current: 20, prior: 12, delta: 8 });
  // matched is new this window → prior volume 0, delta +10.
  assert.deepEqual(bySource.matched.volume, { current: 10, prior: 0, delta: 10 });
  // matched has no prior row → conversion has no baseline.
  assert.equal(bySource.matched.conversionPct.delta, null);
  // applied cleared the floor in both windows → 25 - 17 = +8 pts.
  assert.equal(bySource.applied.conversionPct.delta, 8);
});

test("a conversion delta is suppressed when either window is below the min-n floor", () => {
  const below = MIN_RATE_DELTA_N - 1;
  const cur = slice(10, 1, 12, [], [{ source: "applied", total: below, hireRatePct: 50 }]);
  const prior = slice(10, 1, 12, [], [{ source: "applied", total: 20, hireRatePct: 20 }]);
  const d = periodDeltas(cur, prior);
  // Current side below the floor → rate null → delta null. Volume still diffs.
  assert.equal(d.bySource[0].conversionPct.delta, null);
  assert.equal(d.bySource[0].volume.delta, below - 20);
});

test("per-channel CPA delta is null when spend is windowed-suppressed (both null)", () => {
  const cur = slice(30, 5, 18, [], [], [{ channel: "linkedin", total: 20, hireRatePct: 25, costPerApplicantCzk: null }]);
  const prior = slice(20, 3, 20, [], [], [{ channel: "linkedin", total: 15, hireRatePct: 20, costPerApplicantCzk: null }]);
  const d = periodDeltas(cur, prior);
  assert.deepEqual(d.byChannel[0].costPerApplicantCzk, { current: null, prior: null, delta: null });
  assert.equal(d.byChannel[0].volume.delta, 5);
  assert.equal(d.byChannel[0].conversionPct.delta, 5); // 25 - 20, both ≥ floor
});
