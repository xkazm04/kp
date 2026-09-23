import { test } from "node:test";
import assert from "node:assert/strict";
import { periodDeltas, MIN_RATE_DELTA_N } from "./analytics-deltas.ts";

// `reached` defaults well above the min-n floor and `timeToHireSamples` to the floor,
// so the pre-existing cases keep exercising the arithmetic; the gate cases below set
// them explicitly.
const slice = (
  total: number,
  hired: number,
  avgTimeToHireDays: number | null,
  funnel: { stage: string; conversionPct: number | null; reached?: number }[] = [],
  bySource: { source: string; total: number; hireRatePct: number }[] = [],
  byChannel: { channel: string; total: number; hireRatePct: number; costPerApplicantCzk: number | null }[] = [],
  timeToHireSamples: number = MIN_RATE_DELTA_N
) => ({
  total,
  hired,
  avgTimeToHireDays,
  timeToHireSamples,
  funnel: funnel.map((f) => ({ reached: 100, ...f })),
  bySource,
  byChannel,
});

test("counts and hire-rate diff current minus prior", () => {
  const d = periodDeltas(slice(50, 9, 20), slice(40, 6, 24));
  assert.deepEqual(d.total, { current: 50, prior: 40, delta: 10 });
  assert.deepEqual(d.hired, { current: 9, prior: 6, delta: 3 });
  // 18% vs 15% → +3 pts
  assert.deepEqual(d.hireRatePct, { current: 18, prior: 15, delta: 3, n: { current: 50, prior: 40 }, withheld: null });
  // time-to-hire improved (lower) — delta is negative, direction is the UI's job
  assert.deepEqual(d.avgTimeToHireDays, {
    current: 20,
    prior: 24,
    delta: -4,
    n: { current: MIN_RATE_DELTA_N, prior: MIN_RATE_DELTA_N },
    withheld: null,
  });
});

test("an empty cohort yields a null hire rate (undefined, not 0%)", () => {
  const d = periodDeltas(slice(0, 0, null), slice(10, 2, 30));
  assert.equal(d.hireRatePct.current, null);
  assert.equal(d.hireRatePct.prior, 20);
  assert.equal(d.hireRatePct.delta, null);
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
  assert.equal(byStage.Accepted.current, null);
  assert.equal(byStage.Accepted.prior, null);
  assert.equal(byStage.Accepted.delta, null);
});

test("a stage absent from the prior window has no baseline", () => {
  const cur = slice(10, 1, 12, [{ stage: "Offer", conversionPct: 75 }]);
  const prior = slice(8, 0, null, []);
  const d = periodDeltas(cur, prior);
  const conv = d.funnel[0].conversionPct;
  assert.equal(conv.current, 75);
  assert.equal(conv.prior, null);
  assert.equal(conv.delta, null);
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

// ---- challenge-r06 analytics-computation/A: every rate delta is gated on BOTH sides' n.
// A movement computed off a thin cohort is not shown as a movement: the delta is null and
// the record says why (small-sample-honesty / state-the-accrual-horizon).

test("hire-rate delta is withheld when either cohort is below the min-n floor", () => {
  const thin = MIN_RATE_DELTA_N - 1;
  const d = periodDeltas(slice(thin, 2, null), slice(40, 6, null));
  assert.equal(d.hireRatePct.delta, null, "a 4-candidate cohort's hire rate moved 'by 35 pts' — noise, not signal");
  assert.equal(d.hireRatePct.current, 50, "the figure itself is still real and still carried");
  assert.deepEqual(d.hireRatePct.n, { current: thin, prior: 40 });
  assert.deepEqual(d.hireRatePct.withheld, { reason: "thinCurrent", minN: MIN_RATE_DELTA_N });

  const p = periodDeltas(slice(40, 6, null), slice(thin, 2, null));
  assert.equal(p.hireRatePct.delta, null);
  assert.equal(p.hireRatePct.withheld?.reason, "thinPrior");

  const ok = periodDeltas(slice(MIN_RATE_DELTA_N, 1, null), slice(MIN_RATE_DELTA_N, 2, null));
  assert.equal(ok.hireRatePct.delta, -20, "at the floor on both sides the movement is shown");
  assert.equal(ok.hireRatePct.withheld, null);
});

test("a funnel conversion delta is withheld when either side's UPSTREAM reach is thin", () => {
  const cur = slice(40, 5, null, [
    { stage: "Accepted", conversionPct: null, reached: 40 },
    { stage: "Screened", conversionPct: 50, reached: 20 },
    { stage: "Interview", conversionPct: 20, reached: 4 },
    { stage: "Offer", conversionPct: 75, reached: 3 },
  ]);
  const prior = slice(30, 4, null, [
    { stage: "Accepted", conversionPct: null, reached: 30 },
    { stage: "Screened", conversionPct: 60, reached: 18 },
    { stage: "Interview", conversionPct: 50, reached: 9 },
    { stage: "Offer", conversionPct: 33, reached: 3 },
  ]);
  const byStage = Object.fromEntries(periodDeltas(cur, prior).funnel.map((f) => [f.stage, f.conversionPct]));
  // Screened: upstream 40 vs 30 — both clear the floor.
  assert.equal(byStage.Screened.delta, -10);
  assert.deepEqual(byStage.Screened.n, { current: 40, prior: 30 });
  // Interview: upstream 20 vs 18 — shown.
  assert.equal(byStage.Interview.delta, -30);
  // Offer: upstream (Interview reach) is 4 now — withheld with its reason.
  assert.equal(byStage.Offer.delta, null, "75% of 4 vs 33% of 9 is not a +42 pt movement");
  assert.deepEqual(byStage.Offer.n, { current: 4, prior: 9 });
  assert.deepEqual(byStage.Offer.withheld, { reason: "thinCurrent", minN: MIN_RATE_DELTA_N });
});

test("time-to-hire delta is withheld when either side's SAMPLE is thin", () => {
  const d = periodDeltas(slice(40, 6, 18, [], [], [], 6), slice(40, 6, 30, [], [], [], 2));
  assert.equal(d.avgTimeToHireDays.delta, null, "a 2-hire prior mean is not a baseline");
  assert.deepEqual(d.avgTimeToHireDays.n, { current: 6, prior: 2 });
  assert.deepEqual(d.avgTimeToHireDays.withheld, { reason: "thinPrior", minN: MIN_RATE_DELTA_N });

  const both = periodDeltas(slice(40, 6, 18, [], [], [], 1), slice(40, 6, 30, [], [], [], 2));
  assert.equal(both.avgTimeToHireDays.withheld?.reason, "thinBoth");

  const ok = periodDeltas(slice(40, 6, 18, [], [], [], 5), slice(40, 6, 30, [], [], [], 7));
  assert.equal(ok.avgTimeToHireDays.delta, -12);
  assert.equal(ok.avgTimeToHireDays.withheld, null);
});
