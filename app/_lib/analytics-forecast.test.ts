import { test } from "node:test";
import assert from "node:assert/strict";
import { forecastHires, MIN_FORECAST_HIRES, MIN_FORECAST_INFLOW_WEEKS } from "./analytics-forecast.ts";

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
  const f = forecastHires({ weeklyAdded: [10, 6, 8, 8], funnel, avgTimeToHireDays: 30 });
  assert.equal(f.weeklyVelocity, 8); // (10+6+8)/3
  assert.equal(f.overallConversionPct, 5); // 5/100
  assert.equal(f.etaDays, 30);
  assert.equal(f.hasSignal, true);
});

test("projected inflow hires scale with velocity, horizon and conversion", () => {
  const f = forecastHires({ weeklyAdded: [10, 10, 10, 10], funnel, avgTimeToHireDays: 30, horizonsWeeks: [4, 8] });
  // 10/wk × 4wk × 0.05 = 2 ; × 8wk = 4
  assert.deepEqual(f.projected, [
    { weeks: 4, hires: 2, low: 2, high: 2 },
    { weeks: 8, hires: 4, low: 4, high: 4 },
  ]);
});

test("in-flight expectation credits later stages more than earlier ones", () => {
  const f = forecastHires({ weeklyAdded: [5, 5, 5, 5], funnel, avgTimeToHireDays: 20 });
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

test("a null accept rate leaves the projection byte-identical to the pre-offer math", () => {
  const base = forecastHires({ weeklyAdded: [10, 10, 10, 10], funnel, avgTimeToHireDays: 30, horizonsWeeks: [4, 8] });
  const withNull = forecastHires({ weeklyAdded: [10, 10, 10, 10], funnel, avgTimeToHireDays: 30, horizonsWeeks: [4, 8], offerAcceptRate: null });
  assert.deepEqual(withNull.projected, base.projected);
  assert.equal(withNull.inFlightExpectedHires, base.inFlightExpectedHires);
  assert.equal(withNull.offerAcceptRate, null);
});

test("an observed accept rate rebuilds the offer→hire leg of the projection", () => {
  // Offer stage reached 10 of 100 first-reached → reach-to-offer = 0.10.
  // With a measured 80% accept: effective conversion = 0.10 × 0.80 = 0.08.
  // 10/wk × 4wk × 0.08 = 3.2 ; × 8wk = 6.4.
  const f = forecastHires({ weeklyAdded: [10, 10, 10, 10], funnel, avgTimeToHireDays: 30, horizonsWeeks: [4, 8], offerAcceptRate: 0.8 });
  assert.equal(f.offerAcceptRate, 0.8);
  assert.deepEqual(f.projected, [
    { weeks: 4, hires: 3.2, low: 3.2, high: 3.2 },
    { weeks: 8, hires: 6.4, low: 6.4, high: 6.4 },
  ]);
});

test("the observed accept rate credits in-flight offer-stage candidates directly", () => {
  // Same funnel as the in-flight test; with accept=0.5 the offer row's 2 actives
  // are credited 2×0.5 = 1.0 (vs the funnel-derived 2×(5/10)=1.0 here — chosen so
  // only the accept-rate PATH differs, not the arithmetic). Earlier stages keep
  // their funnel conversion: 10*(5/100)+8*(5/50)+4*(5/20)+2*0.5 = 0.5+0.8+1.0+1.0.
  const f = forecastHires({ weeklyAdded: [5, 5, 5, 5], funnel, avgTimeToHireDays: 20, offerAcceptRate: 0.5 });
  assert.equal(f.inFlightExpectedHires, 3.3);
});

test("an accept rate with no offer leg is ignored (echoed as null)", () => {
  // A two-column board (entry + terminal) is a legal saved axis — the config
  // validator requires exactly that much and no more — and it has NO offer leg:
  // the row before Hired IS the entry row. Reading it as one made offerReached
  // equal firstReached, so the rebuilt conversion collapsed to the accept rate
  // itself and the projection read as if every arrival reached an offer.
  const noOffer = [
    { stage: "Accepted", reached: 40, current: 20 },
    { stage: "Hired", reached: 4, current: 0 },
  ];
  // The other null path: a real three-row funnel whose offer row reached 0.
  const zeroOffer = [
    { stage: "Interview", reached: 20, current: 5 },
    { stage: "Offer", reached: 0, current: 0 },
    { stage: "Hired", reached: 3, current: 0 },
  ];
  const a = forecastHires({ weeklyAdded: [4], funnel: noOffer, avgTimeToHireDays: null, offerAcceptRate: 0.9 });
  const b = forecastHires({ weeklyAdded: [4], funnel: zeroOffer, avgTimeToHireDays: null, offerAcceptRate: 0.9 });
  assert.equal(a.offerAcceptRate, null, "the entry row is not an offer leg");
  // zeroOffer has offerReached 0 → rate ignored, echoed null.
  assert.equal(b.offerAcceptRate, null);
});

test("a two-column board projects on its real conversion, not the accept rate", () => {
  // 10 hires of 100 arrivals = 10 %. Read as an offer leg, the 60 % accept rate
  // replaced that outright: 10/wk × 12wk × 0.60 = 72 hires instead of 12.
  const twoColumn = [
    { stage: "Accepted", reached: 100, current: 30 },
    { stage: "Hired", reached: 10, current: 10 },
  ];
  const f = forecastHires({
    weeklyAdded: [10, 10, 10, 10],
    funnel: twoColumn,
    avgTimeToHireDays: 30,
    horizonsWeeks: [12],
    offerAcceptRate: 0.6,
  });
  assert.equal(f.offerAcceptRate, null);
  assert.deepEqual(f.projected, [{ weeks: 12, hires: 12, low: 12, high: 12 }]);
});

test("an empty cohort yields a null conversion and no signal", () => {
  const f = forecastHires({ weeklyAdded: [], funnel: [{ stage: "Accepted", reached: 0, current: 0 }], avgTimeToHireDays: null });
  assert.equal(f.overallConversionPct, null);
  assert.equal(f.weeklyVelocity, 0);
  assert.equal(f.hasSignal, false);
});

// ── The signal floor ──────────────────────────────────────────────────────
// The projection is the largest number this tab prints and it was the only figure
// on the page with no floor: `hasSignal` asked for ONE hire and said nothing about
// how many weeks the velocity mean rested on. One hire in a burst week licensed a
// twelve-week projection to one decimal place, beside siblings that gate at 3, 5
// and 20. Both inputs are now gated, because both are multiplied.

test("one hire does not license a projection", () => {
  const oneHire = [
    { stage: "Accepted", reached: 40, current: 20 },
    { stage: "Screened", reached: 15, current: 10 },
    { stage: "Interview", reached: 6, current: 3 },
    { stage: "Hired", reached: 1, current: 1 },
  ];
  // Six weeks of steady inflow — the velocity half of the floor is satisfied.
  const f = forecastHires({ weeklyAdded: [8, 6, 7, 9, 5, 8], funnel: oneHire, avgTimeToHireDays: 22 });
  assert.equal(f.hasSignal, false, "a cohort of one hire is not an empirical conversion");
  assert.deepEqual(f.projected.map((p) => p.hires), [0, 0, 0]);
  assert.equal(f.signal.hires, 1);
  assert.equal(f.signal.minHires, MIN_FORECAST_HIRES);
  // The conversion itself is still REPORTED — it is the projection that is withheld.
  assert.equal(f.overallConversionPct, 3);
});

test("a single week of inflow does not license a twelve-week projection", () => {
  // Five hires — plenty of conversion signal — but every candidate arrived in one
  // week. Extrapolating that week forward twelve times is a statement about one week.
  const f = forecastHires({
    weeklyAdded: [0, 0, 0, 0, 0, 0, 0, 40],
    funnel,
    avgTimeToHireDays: 30,
    horizonsWeeks: [12],
  });
  assert.equal(f.hasSignal, false);
  assert.equal(f.signal.inflowWeeks, 1);
  assert.equal(f.signal.minInflowWeeks, MIN_FORECAST_INFLOW_WEEKS);
  assert.deepEqual(f.projected, [{ weeks: 12, hires: 0, low: 0, high: 0 }]);
});

test("exactly at the floor, the forecast projects", () => {
  const atFloor = [
    { stage: "Accepted", reached: 100, current: 10 },
    { stage: "Screened", reached: 50, current: 5 },
    { stage: "Interview", reached: 20, current: 2 },
    { stage: "Offer", reached: 8, current: 1 },
    { stage: "Hired", reached: MIN_FORECAST_HIRES, current: MIN_FORECAST_HIRES },
  ];
  const weekly = Array.from({ length: MIN_FORECAST_INFLOW_WEEKS }, () => 10);
  const f = forecastHires({ weeklyAdded: weekly, funnel: atFloor, avgTimeToHireDays: 30 });
  assert.equal(f.hasSignal, true, "the floor is a minimum, not a threshold to exceed");
  assert.equal(f.signal.hires, MIN_FORECAST_HIRES);
  assert.equal(f.signal.inflowWeeks, MIN_FORECAST_INFLOW_WEEKS);
});

test("quiet weeks still count toward the velocity mean — only toward the floor do they not", () => {
  // Four active weeks + four zero weeks: the floor is met, and the mean is over ALL
  // eight buckets (a quiet week is real evidence of a low rate, not a missing sample).
  const f = forecastHires({ weeklyAdded: [8, 0, 8, 0, 8, 0, 8, 0], funnel, avgTimeToHireDays: 30 });
  assert.equal(f.hasSignal, true);
  assert.equal(f.weeklyVelocity, 4, "the mean is over every bucket, not over the active ones");
  assert.equal(f.signal.inflowWeeks, 4);
});

// ── The range ─────────────────────────────────────────────────────────────

test("the projection carries a range at velocity ± one standard deviation", () => {
  // Buckets 4,8,4,8 → mean 6, population sd 2. Conversion 5/100 = 0.05.
  // point: 6 × 8wk × 0.05 = 2.4 ; low: 4 × 8 × 0.05 = 1.6 ; high: 8 × 8 × 0.05 = 3.2.
  const f = forecastHires({ weeklyAdded: [4, 8, 4, 8], funnel, avgTimeToHireDays: 30, horizonsWeeks: [8] });
  assert.equal(f.weeklyVelocity, 6);
  assert.equal(f.weeklyVelocityStdDev, 2);
  assert.deepEqual(f.projected, [{ weeks: 8, hires: 2.4, low: 1.6, high: 3.2 }]);
  assert.equal(f.method, "velocity-x-conversion", "the figure names the method it came from");
});

test("a perfectly steady inflow has a zero-width range, not a fake one", () => {
  const f = forecastHires({ weeklyAdded: [10, 10, 10, 10], funnel, avgTimeToHireDays: 30, horizonsWeeks: [4] });
  assert.equal(f.weeklyVelocityStdDev, 0);
  assert.deepEqual(f.projected, [{ weeks: 4, hires: 2, low: 2, high: 2 }]);
});

test("the low bound never goes negative", () => {
  // Spiky inflow: mean 8, sd ~9.3, so velocity − sd is below zero. A negative low bound
  // would read as a forecast of un-hiring.
  const f = forecastHires({ weeklyAdded: [1, 1, 20, 1, 20, 1, 20, 0], funnel, avgTimeToHireDays: 30, horizonsWeeks: [12] });
  assert.ok(f.weeklyVelocityStdDev > f.weeklyVelocity, "the fixture is genuinely spikier than its mean");
  assert.equal(f.projected[0].low, 0);
  assert.ok(f.projected[0].high > f.projected[0].hires);
});
