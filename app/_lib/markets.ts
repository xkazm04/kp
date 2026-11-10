// The markets a workspace can run in: the TS mirror of pipeline/jobfit/market_config.py
// MARKETS. Client-safe (no DB, no node:*): the Settings picker and every formatter that
// labels a figure read it. markets.test.ts reads the Python module and fails when the
// two disagree on an id, a currency, a period, a hub or whether a benchmark exists.
//
// A market is a closed vocabulary (literal array -> derived union -> runtime guard,
// the tabs.ts / i18n/locales.ts pattern). Only `cz` holds a salary benchmark; `de` and
// `gb` denominate honestly but kp cannot estimate pay there, so every benchmark-derived
// figure is a stated absence (`no_market_benchmark`), never another market's number.
// There is NO currency conversion anywhere: a figure is shown in the currency it was
// stated in.

import { APP_CURRENCY } from "./format";

export const MARKET_IDS = ["cz", "de", "gb"] as const;
export type MarketId = (typeof MARKET_IDS)[number];
export const DEFAULT_MARKET_ID: MarketId = "cz";

export function isMarketId(value: unknown): value is MarketId {
  return typeof value === "string" && (MARKET_IDS as readonly string[]).includes(value);
}

/** A stored or untrusted value -> a market id, the default when unknown. */
export function resolveMarketId(value: unknown): MarketId {
  const clean = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isMarketId(clean) ? clean : DEFAULT_MARKET_ID;
}

export type PayPeriod = "hour" | "month" | "year";

export type MarketSpec = {
  id: MarketId;
  /** ISO-4217 code a bare figure in this market is denominated in. */
  currency: string;
  /** The pay period a bare band is expressed in. */
  period: PayPeriod;
  /** The hub an ad that names no city is assumed to be in. */
  defaultLocation: string;
  /** Whether kp holds a salary benchmark dataset for this market. */
  hasBenchmark: boolean;
};

export const MARKETS: Readonly<Record<MarketId, MarketSpec>> = Object.freeze({
  cz: { id: "cz", currency: APP_CURRENCY, period: "month", defaultLocation: "Praha", hasBenchmark: true },
  de: { id: "de", currency: "EUR", period: "month", defaultLocation: "Berlin", hasBenchmark: false },
  gb: { id: "gb", currency: "GBP", period: "year", defaultLocation: "London", hasBenchmark: false },
});

export function marketSpec(id: unknown): MarketSpec {
  return MARKETS[resolveMarketId(id)];
}

/** The coded absence a benchmark-derived figure carries in a market without a table. */
export const NO_MARKET_BENCHMARK = "no_market_benchmark";

/** The engine's coded finding when it withheld a CV salary estimate (pipeline.py
 *  withhold_uncalibrated_salary): the market had no benchmark to anchor it on. */
export const SALARY_NO_MARKET_BENCHMARK = "salary_no_market_benchmark";

/** Whether an analysis's salary read was withheld for want of a market benchmark. */
export function salaryWithheldForMarket(findings: readonly { code: string }[] | null | undefined): boolean {
  return (findings ?? []).some((f) => f.code === SALARY_NO_MARKET_BENCHMARK);
}
