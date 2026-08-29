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

test("a null accept rate leaves the projection byte-identical to the pre-offer math", () => {
  const base = forecastHires({ weeklyAdded: [10, 10], funnel, avgTimeToHireDays: 30, horizonsWeeks: [4, 8] });
  const withNull = forecastHires({ weeklyAdded: [10, 10], funnel, avgTimeToHireDays: 30, horizonsWeeks: [4, 8], offerAcceptRate: null });
  assert.deepEqual(withNull.projected, base.projected);
  assert.equal(withNull.inFlightExpectedHires, base.inFlightExpectedHires);
  assert.equal(withNull.offerAcceptRate, null);
});

test("an observed accept rate rebuilds the offer→hire leg of the projection", () => {
  // Offer stage reached 10 of 100 first-reached → reach-to-offer = 0.10.
  // With a measured 80% accept: effective conversion = 0.10 × 0.80 = 0.08.
  // 10/wk × 4wk × 0.08 = 3.2 ; × 8wk = 6.4.
  const f = forecastHires({ weeklyAdded: [10, 10], funnel, avgTimeToHireDays: 30, horizonsWeeks: [4, 8], offerAcceptRate: 0.8 });
  assert.equal(f.offerAcceptRate, 0.8);
  assert.deepEqual(f.projected, [
    { weeks: 4, hires: 3.2 },
    { weeks: 8, hires: 6.4 },
  ]);
});

test("the observed accept rate credits in-flight offer-stage candidates directly", () => {
  // Same funnel as the in-flight test; with accept=0.5 the offer row's 2 actives
  // are credited 2×0.5 = 1.0 (vs the funnel-derived 2×(5/10)=1.0 here — chosen so
  // only the accept-rate PATH differs, not the arithmetic). Earlier stages keep
  // their funnel conversion: 10*(5/100)+8*(5/50)+4*(5/20)+2*0.5 = 0.5+0.8+1.0+1.0.
  const f = forecastHires({ weeklyAdded: [5], funnel, avgTimeToHireDays: 20, offerAcceptRate: 0.5 });
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
    weeklyAdded: [10, 10],
    funnel: twoColumn,
    avgTimeToHireDays: 30,
    horizonsWeeks: [12],
    offerAcceptRate: 0.6,
  });
  assert.equal(f.offerAcceptRate, null);
  assert.deepEqual(f.projected, [{ weeks: 12, hires: 12 }]);
});

test("an empty cohort yields a null conversion and no signal", () => {
  const f = forecastHires({ weeklyAdded: [], funnel: [{ stage: "Accepted", reached: 0, current: 0 }], avgTimeToHireDays: null });
  assert.equal(f.overallConversionPct, null);
  assert.equal(f.weeklyVelocity, 0);
  assert.equal(f.hasSignal, false);
});
