// The market vocabulary exists twice — app/_lib/markets.ts for the app, and
// pipeline/jobfit/market_config.py MARKETS for the spawned pipeline — and the app hands
// the id across the boundary in KP_MARKET. If the two lists drift, a workspace can pick
// a market the pipeline silently resolves to the Czech default (the exact defect this
// seam exists to stop), or label a figure with a currency the pipeline did not price.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { APP_CURRENCY } from "./format.ts";
import { DEFAULT_MARKET_ID, isMarketId, MARKET_IDS, MARKETS, marketSpec, resolveMarketId } from "./markets.ts";

const PY = readFileSync(fileURLToPath(new URL("../../pipeline/jobfit/market_config.py", import.meta.url)), "utf8");

/** The keyword arguments of one `NAME = MarketConfig(...)` block. */
function pyMarket(constName: string): Record<string, string> {
  const start = PY.indexOf(`${constName} = MarketConfig(`);
  assert.ok(start >= 0, `market_config.py has no ${constName}`);
  const body = PY.slice(start, PY.indexOf("\n)", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^\s+(\w+)=(.+?),?\s*$/gm)) out[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  return out;
}

const PY_CONST: Record<string, string> = { cz: "CZECH_MARKET", de: "DE_MARKET", gb: "GB_MARKET" };

test("the TS market list is the Python MARKETS list, in order", () => {
  const m = PY.match(/\{m\.market_id: m for m in \(([^)]*)\)\}/);
  assert.ok(m, "could not find the MARKETS comprehension in market_config.py");
  const consts = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(
    consts.map((c) => pyMarket(c).market_id),
    [...MARKET_IDS],
  );
  assert.equal(DEFAULT_MARKET_ID, "cz");
});

test("each market agrees on currency, period, hub and benchmark presence", () => {
  for (const id of MARKET_IDS) {
    const py = pyMarket(PY_CONST[id]);
    const ts = MARKETS[id];
    assert.equal(py.market_id, id);
    assert.equal(py.currency, ts.currency, `${id} currency`);
    assert.equal(py.period, ts.period, `${id} period`);
    assert.equal(py.default_location, ts.defaultLocation, `${id} default location`);
    assert.equal(py.benchmark_source_id !== "", ts.hasBenchmark, `${id} benchmark presence`);
  }
});

test("the default market is the app's home currency", () => {
  assert.equal(MARKETS[DEFAULT_MARKET_ID].currency, APP_CURRENCY);
});

test("the runtime guard and resolver", () => {
  assert.equal(isMarketId("de"), true);
  assert.equal(isMarketId("DE"), false);
  assert.equal(isMarketId("de-berlin"), false, "the Berlin TEST sample is not a product market");
  assert.equal(resolveMarketId(" GB "), "gb");
  assert.equal(resolveMarketId(undefined), "cz");
  assert.equal(resolveMarketId(42), "cz");
  assert.equal(marketSpec("xx").id, "cz");
  // Only cz is calibrated; a year-period market exists.
  assert.deepEqual(MARKET_IDS.filter((id) => MARKETS[id].hasBenchmark), ["cz"]);
  assert.equal(MARKETS.gb.period, "year");
});
