import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSalaryScale } from "./groupEvalSalaryScale.ts";
import { APP_CURRENCY } from "@/app/_lib/format";
import type { EvalCandidate } from "@/app/features/shared/groupEvalTypes";

// The Salary section plots every column against ONE scale. A cross-currency
// expectation (an EUR number beside a CZK band) is excluded from that scale on
// purpose — mixing it in moves every other bar. That exclusion was untested.

const withSalary = (label: string, minimum: number, maximum: number, currency = APP_CURRENCY): EvalCandidate => ({
  label,
  score: 70,
  seniority: null,
  verdict: "",
  strengths: [],
  gaps: [],
  salaryExpectation: { minimum, maximum, midpoint: (minimum + maximum) / 2, currency, confidence: "medium" },
});

const bare = (label = "Ada"): EvalCandidate => ({ label, score: 70, seniority: null, verdict: "", strengths: [], gaps: [] });

test("the scale spans the role band and the same-currency expectations", () => {
  const { sal, showSalary, lo, hi } = computeSalaryScale([withSalary("Ada", 90_000, 110_000)], [80_000, 120_000]);
  assert.equal(showSalary, true);
  assert.deepEqual([lo, hi], [80_000, 120_000]);
  assert.equal(sal.pct(80_000), 0);
  assert.equal(sal.pct(120_000), 100);
  assert.equal(sal.pct(100_000), 50);
});

test("a cross-currency expectation does NOT stretch the scale", () => {
  const band = [80_000, 120_000];
  const only = computeSalaryScale([withSalary("Ada", 90_000, 110_000)], band);
  const withEur = computeSalaryScale([withSalary("Ada", 90_000, 110_000), withSalary("Bo", 4_000, 5_000, "EUR")], band);
  // Identical scale: the EUR pair (4k–5k) would otherwise drag the minimum to 4 000
  // and plot every CZK bar in the top few percent.
  assert.equal(withEur.sal.pct(100_000), only.sal.pct(100_000));
  assert.equal(withEur.sal.pct(80_000), 0);
});

test("an out-of-band same-currency expectation DOES widen the scale (it is comparable)", () => {
  const { sal } = computeSalaryScale([withSalary("Ada", 140_000, 160_000)], [80_000, 120_000]);
  assert.equal(sal.pct(160_000), 100);
  assert.ok(sal.pct(120_000) < 100);
});

test("no band and no expectations hides the section instead of plotting an empty axis", () => {
  const none = computeSalaryScale([bare()], []);
  assert.equal(none.showSalary, false);
  assert.equal(none.hi, 0);
});

test("a cross-currency expectation still SHOWS the section — its cell carries the not-comparable note", () => {
  assert.equal(computeSalaryScale([withSalary("Bo", 4_000, 5_000, "EUR")], []).showSalary, true);
});

test("percentages are clamped — a value under/over the scale never leaves the track", () => {
  const { sal } = computeSalaryScale([], [80_000, 120_000]);
  assert.equal(sal.pct(10_000), 0);
  assert.equal(sal.pct(999_000), 100);
});

test("the band's currency is the app currency by contract", () => {
  assert.equal(computeSalaryScale([], [1, 2]).bandCurrency, APP_CURRENCY);
});
