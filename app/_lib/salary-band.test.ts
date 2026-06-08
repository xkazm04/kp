// Pins the salary trust boundary (idea-cee08a2d): the JD builder's market-salary
// band comes from `market_salary_cli` via parsePythonJson + an unchecked `as`
// cast, so the band may arrive partial, NaN, wrongly typed, or as the CLI's 0–0
// taxonomy miss. `normalizeMarketSalary` turns any of those into a render-safe
// `available: false` shape so the result panel degrades gracefully instead of
// white-screening on `s.suggestedMaximum` after a 1–2 minute build, or baking a
// literal `undefined` into the saved JD body. `normalizeSalaryBand` underpins it.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_CURRENCY } from "./format.ts";
import {
  isSameCurrency,
  normalizeCurrency,
  normalizeMarketSalary,
  normalizeSalaryBand,
  salaryBandPosition,
} from "./salary-band.ts";

test("normalizeMarketSalary keeps a usable band and marks it available", () => {
  const s = normalizeMarketSalary({
    suggestedMinimum: 80000,
    suggestedMaximum: 110000,
    currency: "CZK",
    confidence: "high",
    summary: "Grounded on three live sources.",
  });
  assert.equal(s.available, true);
  assert.equal(s.suggestedMinimum, 80000);
  assert.equal(s.suggestedMaximum, 110000);
  assert.equal(s.currency, "CZK");
  assert.equal(s.confidence, "high");
  assert.equal(s.summary, "Grounded on three live sources.");
});

test("normalizeMarketSalary swaps a backwards band rather than dropping it", () => {
  const s = normalizeMarketSalary({ suggestedMinimum: 110000, suggestedMaximum: 80000 });
  assert.equal(s.available, true);
  assert.equal(s.suggestedMinimum, 80000);
  assert.equal(s.suggestedMaximum, 110000);
});

test("normalizeMarketSalary treats the CLI's 0–0 taxonomy miss as unavailable", () => {
  const s = normalizeMarketSalary({ suggestedMinimum: 0, suggestedMaximum: 0, summary: "Estimated…" });
  assert.equal(s.available, false);
  assert.equal(s.suggestedMinimum, 0);
  assert.equal(s.suggestedMaximum, 0);
});

test("normalizeMarketSalary marks a missing or NaN maximum unavailable (the crash vector)", () => {
  // The exact shape the requirement names: a band with no suggestedMaximum.
  // The old render did `s.suggestedMaximum.toLocaleString(...)` and threw here.
  assert.equal(normalizeMarketSalary({ suggestedMinimum: 85000 }).available, false);
  assert.equal(normalizeMarketSalary({ suggestedMinimum: 85000, suggestedMaximum: NaN }).available, false);
  assert.equal(normalizeMarketSalary({ suggestedMinimum: 85000, suggestedMaximum: 0 }).available, false);
});

test("normalizeMarketSalary rejects stringified numbers (the cast is a lie, not a parser)", () => {
  const s = normalizeMarketSalary({ suggestedMinimum: "85 000", suggestedMaximum: "110000" });
  assert.equal(s.available, false);
});

test("normalizeMarketSalary tolerates a null / non-object / empty payload", () => {
  for (const payload of [null, undefined, "nope", 42, []]) {
    const s = normalizeMarketSalary(payload);
    assert.equal(s.available, false);
    assert.equal(s.suggestedMinimum, 0);
    assert.equal(s.suggestedMaximum, 0);
  }
});

test("normalizeMarketSalary coerces non-string text fields to safe defaults", () => {
  // A non-string currency/confidence/summary must never reach toLocaleString/JSX
  // as `undefined`; defaults are conservative (currency CZK, confidence "low").
  const s = normalizeMarketSalary({ suggestedMinimum: 80000, suggestedMaximum: 90000, currency: 5, confidence: null, summary: {} });
  assert.equal(s.currency, "CZK");
  assert.equal(s.confidence, "low");
  assert.equal(s.summary, "");
});

test("normalizeMarketSalary is idempotent — safe to re-run at a render boundary", () => {
  const once = normalizeMarketSalary({ suggestedMinimum: 80000, suggestedMaximum: 110000, confidence: "medium" });
  const twice = normalizeMarketSalary(once);
  assert.deepEqual(twice, once);
});

test("normalizeMarketSalary is idempotent on the unavailable shape too", () => {
  const once = normalizeMarketSalary({ suggestedMinimum: 0, suggestedMaximum: 0 });
  const twice = normalizeMarketSalary(once);
  assert.deepEqual(twice, once);
  assert.equal(twice.available, false);
});

test("normalizeSalaryBand underpins the contract: usable band, swap, or null", () => {
  assert.deepEqual(normalizeSalaryBand(80000, 110000), [80000, 110000]);
  assert.deepEqual(normalizeSalaryBand(110000, 80000), [80000, 110000]);
  assert.equal(normalizeSalaryBand(0, 0), null);
  assert.equal(normalizeSalaryBand(85000, undefined), null);
  assert.equal(normalizeSalaryBand(NaN, 90000), null);
  assert.equal(normalizeSalaryBand("80000", "90000"), null);
});

// ---- Currency comparability: the salary-comparison safety contract ----------
// The role band carries no currency and is denominated in APP_CURRENCY; a
// candidate's expectation carries its own. The over/under-band verdict is only
// honest when the two match, since the app does no FX. These lock that gate.

test("normalizeCurrency is case/whitespace-insensitive and blanks to empty", () => {
  assert.equal(normalizeCurrency("czk"), "CZK");
  assert.equal(normalizeCurrency(" CZK "), "CZK");
  assert.equal(normalizeCurrency("eur"), "EUR");
  assert.equal(normalizeCurrency(null), "");
  assert.equal(normalizeCurrency(undefined), "");
  assert.equal(normalizeCurrency("   "), "");
});

test("isSameCurrency matches regardless of case/whitespace", () => {
  assert.equal(isSameCurrency("CZK", "czk"), true);
  assert.equal(isSameCurrency(" CZK ", "CZK"), true);
  assert.equal(isSameCurrency("", ""), true);
});

test("isSameCurrency flags a cross-currency pair — the bug this guards", () => {
  // A EUR expectation against a CZK band must NOT be treated as comparable: that
  // is exactly the case that used to print a confident-but-meaningless "% over".
  assert.equal(isSameCurrency("EUR", APP_CURRENCY), false);
  assert.equal(isSameCurrency("USD", "CZK"), false);
  // A blank expectation currency is not the band currency, so it does not falsely
  // pass the gate here — the producer (salaryExpectationFrom) defaults blanks to
  // APP_CURRENCY upstream, so a real currency-less expectation still compares.
  assert.equal(isSameCurrency("", "CZK"), false);
});

test("salaryBandPosition reports over/under/within with the right percentages", () => {
  assert.deepEqual(salaryBandPosition(130000, 80000, 100000), { position: "over", pct: 30 });
  assert.deepEqual(salaryBandPosition(60000, 80000, 100000), { position: "under", pct: 25 });
  assert.deepEqual(salaryBandPosition(90000, 80000, 100000), { position: "within", pct: 0 });
  // Boundaries are inclusive — sitting exactly on the band edge is "within".
  assert.deepEqual(salaryBandPosition(100000, 80000, 100000), { position: "within", pct: 0 });
  assert.deepEqual(salaryBandPosition(80000, 80000, 100000), { position: "within", pct: 0 });
});

test("salaryBandPosition won't manufacture a verdict from a degenerate band", () => {
  // No usable max → nothing to be "over"; no usable min → nothing to be "under".
  assert.deepEqual(salaryBandPosition(130000, 80000, 0), { position: "within", pct: 0 });
  assert.deepEqual(salaryBandPosition(40000, 0, 100000), { position: "within", pct: 0 });
});
