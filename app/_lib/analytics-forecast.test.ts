import { test } from "node:test";
import assert from "node:assert/strict";
import { forecastHires } from "./analytics-forecast.ts";

// A funnel: 100 reached Accepted, 50 Screened, 20 Interview, 10 Offer, 5 Hired,
// with some still active mid-pipeline.
const funnel = [
  { stage: "Accepted", reached: 100, current: 10 },
  { stage: "Screened", reached: 50, current: 8 },
  { stage: "Interview", reached: 20, current: 4 },
  { stage: "Offer", reached: 10, current: 2 },
  { stage: "Hired", reached: 5, current: 5 },
];

test("velocity is the mean weekly inflow and conversion is hired/first reached", () => {
  const f = forecastHires({ weeklyAdded: [10, 6, 8], funnel, avgTimeToHireDays: 30 });
  assert.equal(f.weeklyVelocity, 8); // (10+6+8)/3
  assert.equal(f.overallConversionPct, 5); // 5/100
  assert.equal(f.etaDays, 30);
  assert.equal(f.hasSignal, true);
});

test("projected inflow hires scale with velocity, horizon and conversion", () => {
  const f = forecastHires({ weeklyAdded: [10, 10], funnel, avgTimeToHireDays: 30, horizonsWeeks: [4, 8] });
  // 10/wk × 4wk × 0.05 = 2 ; × 8wk = 4
  assert.deepEqual(f.projected, [
    { weeks: 4, hires: 2 },
    { weeks: 8, hires: 4 },
  ]);
});

test("in-flight expectation credits later stages more than earlier ones", () => {
  const f = forecastHires({ weeklyAdded: [5], funnel, avgTimeToHireDays: 20 });
  // Σ current × (hiredReached/reached): 10*(5/100)+8*(5/50)+4*(5/20)+2*(5/10)
  // = 0.5 + 0.8 + 1.0 + 1.0 = 3.3 ; the Hired row is excluded (already hired).
  assert.equal(f.inFlightExpectedHires, 3.3);
});

test("no hires yet → no signal, flat-zero projection (not a misleading forecast)", () => {
  const noHires = [
    { stage: "Accepted", reached: 40, current: 20 },
    { stage: "Screened", reached: 15, current: 10 },
    { stage: "Hired", reached: 0, current: 0 },
  ];
  const f = forecastHires({ weeklyAdded: [12, 8], funnel: noHires, avgTimeToHireDays: null });
  assert.equal(f.hasSignal, false);
  assert.equal(f.overallConversionPct, 0);
  assert.equal(f.inFlightExpectedHires, 0);
  assert.deepEqual(f.projected.map((p) => p.hires), [0, 0, 0]);
});

test("an empty cohort yields a null conversion and no signal", () => {
  const f = forecastHires({ weeklyAdded: [], funnel: [{ stage: "Accepted", reached: 0, current: 0 }], avgTimeToHireDays: null });
  assert.equal(f.overallConversionPct, null);
  assert.equal(f.weeklyVelocity, 0);
  assert.equal(f.hasSignal, false);
});
