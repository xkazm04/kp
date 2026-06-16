import { test } from "node:test";
import assert from "node:assert/strict";
import { periodDeltas } from "./analytics-deltas.ts";

const slice = (
  total: number,
  hired: number,
  avgTimeToHireDays: number | null,
  funnel: { stage: string; conversionPct: number | null }[] = []
) => ({ total, hired, avgTimeToHireDays, funnel });

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
