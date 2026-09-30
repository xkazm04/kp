// Gig rewards in USD (gigs/fx.ts) over a fake fetch, a fake DNS and a fake clock - no network.
// Proves: the rate direction (units per ONE US dollar: 12,500 INR at 95.92 INR/USD is 130.32
// USD); the pegged stablecoins; USD, a missing amount and an unknown currency get no estimate;
// a stale `usd` is never trusted; both answer shapes parse and junk does not; the read goes
// through the egress guard and politeFetch, once per FX_CACHE_MS; offline, a refused host, a
// failed fetch and an unreadable answer are all "no conversion", never a throw.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FetchOutcome, PoliteFetchOptions } from "../jobseeker/fetch/politeFetch.ts";
import {
  convertRewardToUsd,
  FX_CACHE_MS,
  FX_SOURCE,
  FX_URL,
  loadFxRates,
  parseFxRates,
  resetFxCache,
  rewardNeedsFx,
  type FxDeps,
  type FxTable,
} from "./fx.ts";

const NOW = "2026-09-30T07:00:00.000Z";
const TABLE: FxTable = {
  rates: { INR: { rate: 95.92, date: "2026-09-30" }, EUR: { rate: 0.88049, date: "2026-09-30" }, GBP: { rate: 0.75489, date: null } },
  fetchedAt: NOW,
  source: FX_SOURCE,
};
const V2 = JSON.stringify([
  { date: "2026-09-30", base: "USD", quote: "INR", rate: 95.92 },
  { date: "2026-09-30", base: "USD", quote: "EUR", rate: 0.88049 },
  { date: "2026-09-29", base: "USD", quote: "GBP", rate: 0.75489 },
  { date: "2026-09-30", base: "EUR", quote: "CZK", rate: 24.4 },
  { date: "2026-09-30", base: "USD", quote: "BAD", rate: -1 },
  { date: "2026-09-30", base: "USD", quote: "usd", rate: 1 },
]);

beforeEach(() => resetFxCache());

test("convertRewardToUsd: the rate is units per ONE US dollar, so the amount is DIVIDED by it", () => {
  const inr = convertRewardToUsd({ amount: 12500, currency: "INR", text: "₹12,500" }, TABLE, NOW);
  assert.deepEqual(inr?.usd, { amount: 130.32, rate: 95.92, rateAt: "2026-09-30", source: FX_SOURCE });
  assert.equal(convertRewardToUsd({ amount: 400, currency: "eur ", text: "€400" }, TABLE, NOW)?.usd?.amount, 454.29, "EUR included, the code normalised");
  assert.equal(convertRewardToUsd({ amount: 100, currency: "GBP", text: "£100" }, TABLE, NOW)?.usd?.rateAt, NOW, "no rate date: the read time");
  assert.equal(inr?.amount, 12500, "the listing's own figure is untouched");
  assert.equal(inr?.text, "₹12,500");
});

test("convertRewardToUsd: pegged coins at 1; USD, no amount, an unknown currency or no table get none; a stale usd is dropped", () => {
  assert.deepEqual(convertRewardToUsd({ amount: 90.456, currency: "USDC", text: "90 USDC" }, null, NOW)?.usd, { amount: 90.46, rate: 1, rateAt: NOW, source: "usd-pegged" });
  assert.equal(convertRewardToUsd({ amount: 5, currency: "USDT", text: "5 USDT" }, TABLE, NOW)?.usd?.source, "usd-pegged");
  for (const reward of [
    { amount: 250, currency: "USD", text: "$250" },
    { amount: null, currency: "INR", text: "negotiable" },
    { amount: 0, currency: "INR", text: "₹0" },
    { amount: 10, currency: null, text: "10" },
    { amount: 10, currency: "XYZ", text: "10 XYZ" },
  ]) {
    assert.equal(convertRewardToUsd(reward, TABLE, NOW)?.usd, undefined, JSON.stringify(reward));
  }
  assert.equal(convertRewardToUsd({ amount: 12500, currency: "INR", text: "x" }, null, NOW)?.usd, undefined, "offline: no table, no estimate");
  const stale = { amount: 250, currency: "USD", text: "$250", usd: { amount: 1, rate: 9, rateAt: "2020-01-01", source: "forged" } };
  assert.deepEqual(convertRewardToUsd(stale, TABLE, NOW), { amount: 250, currency: "USD", text: "$250" });
  assert.equal(convertRewardToUsd(null, TABLE, NOW), null);
});

test("rewardNeedsFx: only an amount in a non-USD ISO currency the table would have to know", () => {
  assert.equal(rewardNeedsFx({ amount: 1, currency: "INR", text: "" }), true);
  for (const r of [null, { amount: 1, currency: "USD", text: "" }, { amount: 1, currency: "USDC", text: "" }, { amount: null, currency: "INR", text: "" }, { amount: 1, currency: "$", text: "" }]) {
    assert.equal(rewardNeedsFx(r), false, JSON.stringify(r));
  }
});

test("parseFxRates: the v2 rows and the v1 object; junk, another base and bad rates are skipped", () => {
  const v2 = parseFxRates(V2, NOW);
  assert.deepEqual(v2?.rates, { INR: { rate: 95.92, date: "2026-09-30" }, EUR: { rate: 0.88049, date: "2026-09-30" }, GBP: { rate: 0.75489, date: "2026-09-29" } });
  const v1 = parseFxRates(JSON.stringify({ amount: 1, base: "USD", date: "2026-09-29", rates: { INR: 95.98, AUD: 1.4277, X: 3 } }), NOW);
  assert.deepEqual(v1?.rates, { INR: { rate: 95.98, date: "2026-09-29" }, AUD: { rate: 1.4277, date: "2026-09-29" } });
  for (const junk of ["not json", "[]", "{}", JSON.stringify({ base: "EUR", rates: { INR: 90 } })]) assert.equal(parseFxRates(junk, NOW), null, junk);
});

type Seen = { fetched: string[]; looked: string[]; logs: string[] };

function deps(opts: { answer?: FetchOutcome; dns?: Array<{ address: string }>; offline?: boolean; nowMs?: () => number } = {}): { deps: FxDeps; seen: Seen } {
  const seen: Seen = { fetched: [], looked: [], logs: [] };
  return {
    seen,
    deps: {
      fetch: async (url: string, o: PoliteFetchOptions) => {
        assert.equal(typeof o.hopGuard, "function", "every redirect hop is vetted too");
        seen.fetched.push(url);
        return opts.answer ?? { kind: "ok", status: 200, contentType: "application/json", body: V2, finalUrl: url, stream: null };
      },
      lookup: async (host: string) => {
        seen.looked.push(host);
        return opts.dns ?? [{ address: "104.26.0.1" }];
      },
      offline: () => opts.offline ?? false,
      now: () => NOW,
      nowMs: opts.nowMs ?? (() => 1_000_000),
      log: (line) => seen.logs.push(line),
    },
  };
}

test("loadFxRates: one guarded, polite read, cached for FX_CACHE_MS", async () => {
  let clock = 1_000_000;
  const { deps: d, seen } = deps({ nowMs: () => clock });
  const first = await loadFxRates(d);
  assert.equal(first?.rates.INR.rate, 95.92);
  assert.deepEqual(seen.fetched, [FX_URL]);
  assert.deepEqual(seen.looked, ["api.frankfurter.dev"], "the egress guard resolved the host before the read");
  clock += FX_CACHE_MS - 1;
  assert.equal(await loadFxRates(d), first, "a burst of scans reads it once");
  assert.equal(seen.fetched.length, 1);
  clock += 2;
  await loadFxRates(d);
  assert.equal(seen.fetched.length, 2, "an old table is read again");
});

test("loadFxRates: offline, a private address, a failed read or an unreadable answer is no conversion, never a throw", async () => {
  const offline = deps({ offline: true });
  assert.equal(await loadFxRates(offline.deps), null);
  assert.deepEqual(offline.seen.fetched, [], "offline never resolves or fetches");
  assert.deepEqual(offline.seen.looked, []);

  const privateHost = deps({ dns: [{ address: "10.0.0.5" }] });
  assert.equal(await loadFxRates(privateHost.deps), null);
  assert.deepEqual(privateHost.seen.fetched, [], "a host that resolves privately is never requested");

  const down = deps({ answer: { kind: "outage", status: 503, detail: "http_503" } });
  assert.equal(await loadFxRates(down.deps), null);
  assert.ok(down.seen.logs.some((l) => l.includes("outage")));

  const junk = deps({ answer: { kind: "ok", status: 200, contentType: "application/json", body: "<html>", finalUrl: FX_URL, stream: null } });
  assert.equal(await loadFxRates(junk.deps), null);

  const thrower = deps();
  thrower.deps.fetch = async () => {
    throw new Error("socket hang up");
  };
  assert.equal(await loadFxRates(thrower.deps), null);
  assert.ok(thrower.seen.logs.length > 0);
});
