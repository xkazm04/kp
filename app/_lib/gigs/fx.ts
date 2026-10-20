// Gig rewards in US dollars: a listing's non-USD reward gets an ESTIMATE in USD at the rate
// valid when the scan filed it (operator, 2026-09-30: "If currency other than Euro/Dollar,
// estimate in dollar with rate valid in time of the scan"; the freelance lane carries many
// INR listings). The estimate rides beside the listing's own figure as `reward.usd`
// (types.ts GigRewardUsd) with its rate, the rate's date and its source, so it is never
// mistaken for what the client stated.
//
// THE RATES. One keyless public JSON endpoint, read once per scan: Frankfurter's v2 rates
// with USD as the base (FX_URL; `[{date, base, quote, rate}]`, where `rate` is units of the
// quote currency per ONE US dollar - so 12,500 INR at 95.92 INR/USD is 130.32 USD). v1
// answers with a `deprecation` header naming v2 as its successor (probed 2026-09-30), so v2 is
// the one read; v1's `{rates: {...}}` object shape is still parsed, in case the service
// falls back to it. NOT an LLM web search: a model can misread or invent a number, and the
// operator asked for "a current online rate", which a published rate table is.
//
// THE RULES:
//   - the one request goes through kp's egress guard (ats-egress-guard.ts: https, a public
//     host, every resolved address public) and politeFetch (robots.txt, per-host spacing);
//     no raw fetch reaches the internet;
//   - KP_OFFLINE, a refused host, a failed fetch or an unreadable answer is NO conversion:
//     `usd` stays absent, the reason is logged once, the scan goes on. Never a guessed rate;
//   - USDC and USDT are pegged at 1 (source `usd-pegged`), with or without the table;
//   - USD itself, a reward with no amount, a currency the table does not know: no `usd`;
//   - the table is kept in memory for FX_CACHE_MS, so a burst of scans reads it once.
//
// Everything with an effect is injected (FxDeps) so fx.test.ts runs over a fake fetch, a
// fake DNS and a fake clock.

import { assertPublicHttpsEndpointResolved, type HostLookup } from "../ats-egress-guard";
import { politeFetch, type PoliteFetch } from "../jobseeker/fetch/politeFetch";
import { isOffline } from "../offline";
import type { GigReward, GigRewardUsd } from "./types";

export const FX_URL = "https://api.frankfurter.dev/v2/rates?base=USD";
/** What `reward.usd.source` says for a converted reward. */
export const FX_SOURCE = "frankfurter.dev rates (base USD)";
export const FX_PEGGED_SOURCE = "usd-pegged";
/** Stablecoins pegged 1:1 to the US dollar. */
export const USD_PEGGED: ReadonlySet<string> = new Set(["USDC", "USDT"]);
/** How long one read of the table serves later scans in this process. */
export const FX_CACHE_MS = 3 * 60 * 60_000;
const FX_FETCH_SOURCE = "gig-fx";
const CURRENCY = /^[A-Z]{3}$/;

/** Units of each currency per ONE US dollar, with the date each rate is valid for. */
export type FxTable = {
  rates: Readonly<Record<string, { rate: number; date: string | null }>>;
  /** When kp read the table (ISO). */
  fetchedAt: string;
  source: string;
};

export type FxDeps = {
  fetch: PoliteFetch;
  lookup: HostLookup;
  offline: () => boolean;
  now: () => string;
  nowMs: () => number;
  log: (line: string, error?: unknown) => void;
};

async function dnsLookup(host: string): Promise<Array<{ address: string }>> {
  // Lazy: node:dns stays off every graph until the rates are actually read.
  const { lookup } = await import("node:dns/promises");
  return lookup(host, { all: true, verbatim: true });
}

export function defaultFxDeps(): FxDeps {
  return {
    fetch: politeFetch,
    lookup: dnsLookup,
    offline: () => isOffline(),
    now: () => new Date().toISOString(),
    nowMs: () => Date.now(),
    log: (line, error) => (error === undefined ? console.warn(`[gigs:fx] ${line}`) : console.error(`[gigs:fx] ${line}`, error)),
  };
}

function goodRate(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function goodDate(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** The rate table from the endpoint's answer, or null when it holds no usable rate. Reads
 *  v2 (`[{date, base: "USD", quote, rate}]`) and v1 (`{base: "USD", date, rates: {...}}`);
 *  a row on another base, a non-ISO code or a non-positive rate is skipped. Pure. */
export function parseFxRates(body: string, fetchedAt: string): FxTable | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  const rates: Record<string, { rate: number; date: string | null }> = {};
  if (Array.isArray(data)) {
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const quote = typeof r.quote === "string" ? r.quote.toUpperCase() : "";
      if (r.base !== "USD" || !CURRENCY.test(quote) || !goodRate(r.rate)) continue;
      rates[quote] = { rate: r.rate, date: goodDate(r.date) };
    }
  } else if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const table = d.rates && typeof d.rates === "object" && !Array.isArray(d.rates) ? (d.rates as Record<string, unknown>) : null;
    if (d.base === "USD" && table) {
      for (const [code, rate] of Object.entries(table)) {
        const quote = code.toUpperCase();
        if (CURRENCY.test(quote) && goodRate(rate)) rates[quote] = { rate, date: goodDate(d.date) };
      }
    }
  }
  delete rates.USD;
  return Object.keys(rates).length > 0 ? { rates, fetchedAt, source: FX_SOURCE } : null;
}

/** The reward with its USD estimate (see the header's rules). `now` is the scan's clock, the
 *  `rateAt` of a pegged coin. Any `usd` the input carried is replaced, never trusted. Pure. */
export function convertRewardToUsd(reward: GigReward | null, table: FxTable | null, now: string): GigReward | null {
  if (!reward) return null;
  // Any `usd` the input carried is dropped: only this scan's rate is trusted.
  const base: GigReward = { ...reward };
  delete base.usd;
  const amount = base.amount;
  const currency = typeof base.currency === "string" ? base.currency.trim().toUpperCase() : "";
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || !currency || currency === "USD") return base;
  let usd: GigRewardUsd | null = null;
  if (USD_PEGGED.has(currency)) {
    usd = { amount: Math.round(amount * 100) / 100, rate: 1, rateAt: now, source: FX_PEGGED_SOURCE };
  } else {
    const hit = table?.rates[currency];
    if (hit && goodRate(hit.rate)) {
      usd = { amount: Math.round((amount / hit.rate) * 100) / 100, rate: hit.rate, rateAt: hit.date ?? table.fetchedAt, source: table.source };
    }
  }
  return usd ? { ...base, usd } : base;
}

/** Whether converting this reward needs the rate table (a pegged coin does not). Pure. */
export function rewardNeedsFx(reward: GigReward | null): boolean {
  if (!reward || typeof reward.amount !== "number" || !Number.isFinite(reward.amount) || reward.amount <= 0) return false;
  const currency = typeof reward.currency === "string" ? reward.currency.trim().toUpperCase() : "";
  return CURRENCY.test(currency) && currency !== "USD" && !USD_PEGGED.has(currency);
}

let cache: { table: FxTable; atMs: number } | null = null;

/** Forget the cached table (tests). */
export function resetFxCache(): void {
  cache = null;
}

/** The current rate table: the cached one while younger than FX_CACHE_MS, else ONE read
 *  through the egress guard and politeFetch. Null (logged) when offline, refused, failed or
 *  unreadable - the caller converts nothing. Never throws. */
export async function loadFxRates(deps: FxDeps = defaultFxDeps()): Promise<FxTable | null> {
  const nowMs = deps.nowMs();
  if (cache && nowMs - cache.atMs < FX_CACHE_MS) return cache.table;
  if (deps.offline()) {
    deps.log("offline: rewards are not converted to USD");
    return null;
  }
  try {
    await assertPublicHttpsEndpointResolved(FX_URL, "fx rates", deps.lookup);
    const hopGuard = async (next: URL): Promise<string | null> => {
      try {
        await assertPublicHttpsEndpointResolved(next.href, "fx rates", deps.lookup);
        return null;
      } catch {
        return "not_public_host";
      }
    };
    const out = await deps.fetch(FX_URL, { sourceId: FX_FETCH_SOURCE, accept: "application/json", hopGuard });
    if (out.kind !== "ok") {
      deps.log(`the rate table did not answer (${out.kind}${out.detail ? `: ${out.detail}` : ""}); rewards are not converted`);
      return null;
    }
    const table = parseFxRates(out.body, deps.now());
    if (!table) {
      deps.log("the rate table answered in a shape kp cannot read; rewards are not converted");
      return null;
    }
    cache = { table, atMs: nowMs };
    return table;
  } catch (error) {
    deps.log("reading the rate table failed; rewards are not converted", error);
    return null;
  }
}
