import { formatSalaryRange } from "@/app/_lib/format";
import type { Salary } from "./coach/winnabilityTypes";

// bug-ui-scan-2026-07-09 (sourcing-campaigns-rediscovery #5): render the winnability
// coach's salary band through the shared salary formatter instead of a local `cs-CZ` +
// hardcoded "CZK" template. The `locale` argument is the READER's locale (format.ts
// number-locale contract): this module is locale-dumb, so the client panel threads
// next-intl's active locale in. Omitting it keeps the English default.
//
// `currency` is the band's OWN currency as winnability.py states it (`jobCurrency` for
// the role's band, `marketCurrency` for the benchmark band): a band is never labelled
// in a currency it was not set in (docs/architecture/markets.md). Omitted, the
// formatter's default market currency applies, which is what the tests assert.
export function fmtBand(band: [number, number] | null, locale?: string, currency?: string): string | null {
  return band ? formatSalaryRange(band[0], band[1], { locale, currency: currency || undefined }) : null;
}

/** Why the coach did NOT compare the role's salary with the market, or null when it did
 *  (`belowMarket` is a boolean) or there is nothing to say (no salary block). The
 *  verdict's third state: a refused comparison is never read as "in line with the
 *  market" (registry: currency-lock-and-no-silent-conversion). Order = the most
 *  specific cause first. */
export type SalaryNotCompared = "noMarketBenchmark" | "bandOtherUnit" | "otherCurrency" | "noStatedPay" | "assumedSeniority" | "noMarketBand" | "noJobBand";

export function salaryNotCompared(salary: Salary | null | undefined): SalaryNotCompared | null {
  if (!salary) return null;
  if (salary.marketAbsence === "no_market_benchmark") return "noMarketBenchmark";
  if (salary.bandAbsence === "band_other_currency") return "bandOtherUnit";
  if (salary.currencyComparable === false) return "otherCurrency";
  if (salary.assumedInputs?.includes("salary_band")) return "noStatedPay";
  if (salary.assumedInputs?.includes("seniority")) return "assumedSeniority";
  // winnability.py answers `false` (not null) when either band is missing, so a
  // boolean alone is not proof that two bands were compared.
  if (!salary.marketBand) return "noMarketBand";
  if (!salary.jobBand) return "noJobBand";
  return typeof salary.belowMarket === "boolean" ? null : "noMarketBand";
}
