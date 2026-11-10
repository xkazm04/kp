// A figure is labelled in the currency and period of the market it was stated in, never
// converted, and a market with no benchmark reads as a stated absence. The default
// market (`cz`) must render exactly what it rendered before markets existed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSalaryRange } from "./format.ts";
import { MARKETS, NO_MARKET_BENCHMARK, salaryWithheldForMarket } from "./markets.ts";
import { marketSalaryLabel, normalizeMarketSalary } from "./salary-band.ts";
import { cohortRoleBand } from "./analyze-cohort-view.ts";

test("the formatter renders each market's own unit and period", () => {
  for (const id of ["cz", "de", "gb"] as const) {
    const m = MARKETS[id];
    assert.equal(
      formatSalaryRange(40000, 60000, { currency: m.currency, period: m.period, locale: "en" }),
      `40,000–60,000 ${m.currency} / ${m.period}`
    );
  }
});

test("a market-salary payload keeps its period, and a Czech one is unchanged", () => {
  const cz = normalizeMarketSalary({ suggestedMinimum: 65500, suggestedMaximum: 103000, currency: "CZK", confidence: "low", summary: "" });
  assert.equal(cz.period, "month");
  assert.equal(cz.absence, null);
  assert.equal(marketSalaryLabel(cz, "en"), "65,500–103,000 CZK / month");
  const gb = normalizeMarketSalary({ suggestedMinimum: 50000, suggestedMaximum: 70000, currency: "GBP", period: "year" });
  assert.equal(marketSalaryLabel(gb, "en"), "50,000–70,000 GBP / year");
});

test("the CLI's no-benchmark answer normalizes to a coded absence, never a band", () => {
  const de = normalizeMarketSalary({ suggestedMinimum: 0, suggestedMaximum: 0, currency: "EUR", absence: NO_MARKET_BENCHMARK });
  assert.equal(de.available, false);
  assert.equal(de.absence, NO_MARKET_BENCHMARK);
  assert.equal(marketSalaryLabel(de, "en"), "");
  assert.equal(normalizeMarketSalary({ absence: "something else" }).absence, null);
});

test("a withheld CV salary estimate is recognised by its finding code", () => {
  assert.equal(salaryWithheldForMarket([{ code: "salary_no_market_benchmark" }]), true);
  assert.equal(salaryWithheldForMarket([{ code: "salary_absent" }]), false);
  assert.equal(salaryWithheldForMarket(null), false);
});

test("a bare role band is read in the workspace's market units (period year proven)", () => {
  const job = { salaryBand: [50000, 70000], defaultedFields: [] } as unknown as Parameters<typeof cohortRoleBand>[0];
  assert.deepEqual(cohortRoleBand(job), { currency: "CZK", period: "month", min: 50000, max: 70000 });
  assert.deepEqual(cohortRoleBand(job, MARKETS.gb), { currency: "GBP", period: "year", min: 50000, max: 70000 });
});
