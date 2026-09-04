import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readProviderPrices,
  reconcileCatalogPrice,
  packUsdCents,
  priceTargets,
  reconcileFetchedProducts,
} from "./price-reconcile.ts";
import { PACKS, PLANS } from "./plans.ts";

// bug-ui-scan-2026-07-09 (plans-checkout-billing-ui #4): the invariant "catalog price
// == charged price" had no test tying the two sources of truth together. These are it.

test("readProviderPrices flattens fixed prices and skips unparseable rows", () => {
  const product = {
    prices: [
      { amount_type: "fixed", price_currency: "USD", price_amount: 3400 },
      { amount_type: "fixed", price_currency: "czk", price_amount: 79000 },
      { amount_type: "custom" }, // no currency/amount → skipped, not guessed
      null,
      42,
    ],
  };
  assert.deepEqual(readProviderPrices(product), [
    { currency: "usd", amountMinor: 3400 },
    { currency: "czk", amountMinor: 79000 },
  ]);
  assert.deepEqual(readProviderPrices({}), []);
  assert.deepEqual(readProviderPrices(null), []);
});

test("consistent CZK + USD → no drift", () => {
  const drift = reconcileCatalogPrice(
    "Starter",
    { priceCzk: 240, priceUsdApprox: 10 },
    [
      { currency: "czk", amountMinor: 24000 },
      { currency: "usd", amountMinor: 1000 },
    ],
  );
  assert.deepEqual(drift, []);
});

test("CZK mismatch is an ERROR (the primary displayed price diverged from the charge)", () => {
  const drift = reconcileCatalogPrice("Starter", { priceCzk: 240, priceUsdApprox: 10 }, [
    { currency: "czk", amountMinor: 25000 }, // product charges 250 Kč, catalog shows 240
  ]);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].level, "error");
});

test("missing CZK price is a WARN (customer shown a CZK price they can't be charged)", () => {
  const drift = reconcileCatalogPrice("Pack", { priceCzk: 790, priceUsdApprox: 34 }, [
    { currency: "usd", amountMinor: 3400 }, // USD-only product, catalog shows 790 Kč primary
  ]);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].level, "warn");
});

test("USD is approximate — within ±10% is fine, outside is an error", () => {
  // 34*100=3400 expected; 3600 is ~5.9% off → OK; 4000 is ~17.6% off → error.
  assert.deepEqual(
    reconcileCatalogPrice("Pack", { priceCzk: 0, priceUsdApprox: 34 }, [{ currency: "usd", amountMinor: 3600 }]),
    [],
  );
  const off = reconcileCatalogPrice("Pack", { priceCzk: 0, priceUsdApprox: 34 }, [
    { currency: "usd", amountMinor: 4000 },
  ]);
  assert.equal(off.length, 1);
  assert.equal(off[0].level, "error");
});

test("the pack price helper derives from the catalog (one source of truth)", () => {
  assert.equal(packUsdCents(), PACKS.minutes_100.priceUsdApprox * 100);
  assert.equal(packUsdCents(), 3400); // matches the value polar-setup used to hardcode
});

// ---- the standing daily check's pure half -----------------------------------------

const czk = (kc: number) => [{ currency: "czk", amountMinor: Math.round(kc * 100) }];
/** A product body shaped the way readProviderPrices reads one. */
const product = (kc: number) => ({ prices: [{ price_currency: "CZK", price_amount: Math.round(kc * 100) }] });

test("priceTargets covers exactly the products this deployment configured", () => {
  assert.deepEqual(priceTargets({ starter: null, growth: null, byom: null, minutePack: null }), []);
  const targets = priceTargets({ starter: "p_s", growth: null, byom: null, minutePack: "p_pack" });
  assert.deepEqual(
    targets.map((t) => t.productId),
    ["p_s", "p_pack"],
    "an unset product id must drop out rather than be reconciled against nothing"
  );
  assert.equal(targets[0].catalog.priceCzk, PLANS.starter.priceCzk, "prices come from plans.ts, never a second copy");
  assert.equal(targets[1].catalog.priceCzk, PACKS.minutes_100.priceCzk);
});

test("a LEGACY tier is still reconciled — withdrawn from sale, still charged", () => {
  // BYOM cannot be bought any more but existing subscribers are billed for it every
  // month, which is precisely a price that must not drift unnoticed.
  const targets = priceTargets({ starter: null, growth: null, byom: "p_byom", minutePack: null });
  assert.deepEqual(targets.map((t) => t.productId), ["p_byom"]);
});

test("agreement is silent: no drift, no alert", () => {
  const targets = priceTargets({ starter: "p_s", growth: null, byom: null, minutePack: null });
  const outcome = reconcileFetchedProducts(targets, new Map([["p_s", product(PLANS.starter.priceCzk)]]));
  assert.deepEqual(outcome.drifts, []);
  assert.equal(outcome.alert, null);
});

test("a product we could NOT read is unknown, never drift", () => {
  // A network blip, an expired token or a deleted product must not raise "you are
  // charging the wrong price" — an alarm that lies is an alarm that gets muted.
  const targets = priceTargets({ starter: "p_s", growth: null, byom: null, minutePack: null });
  assert.deepEqual(reconcileFetchedProducts(targets, new Map()), { drifts: [], alert: null });
});

test("a CZK mismatch alerts, and the ref is stable across runs but specific to the product", () => {
  const targets = priceTargets({ starter: "p_s", growth: "p_g", byom: null, minutePack: null });
  const fetched = new Map<string, unknown>([
    ["p_s", product(PLANS.starter.priceCzk + 40)], // the dashboard was edited
    ["p_g", product(PLANS.growth.priceCzk)],
  ]);
  const first = reconcileFetchedProducts(targets, fetched);
  assert.equal(first.alert?.providerRef, "price-drift:p_s", "only the drifting product is named");
  assert.match(String(first.alert?.detail), /Starter/);
  // Same misconfiguration tomorrow → the SAME ref, so recordBillingAlert's unresolved
  // dedupe collapses a standing drift to one open alert instead of one a day.
  assert.equal(reconcileFetchedProducts(targets, fetched).alert?.providerRef, "price-drift:p_s");
  // A second product drifting is a DIFFERENT situation and opens its own alert.
  fetched.set("p_g", product(PLANS.growth.priceCzk + 10));
  assert.equal(reconcileFetchedProducts(targets, fetched).alert?.providerRef, "price-drift:p_g,p_s");
});

test("a warn-level note does not wake anybody — only an error alerts", () => {
  // "the catalog shows a CZK price the product has no CZK price for" is a note the
  // preflight prints; a daily alert for it would train an operator to mute the channel
  // that also carries real drift.
  const targets = priceTargets({ starter: "p_s", growth: null, byom: null, minutePack: null });
  const outcome = reconcileFetchedProducts(targets, new Map([["p_s", { prices: [] }]]));
  assert.equal(outcome.drifts.length, 1);
  assert.equal(outcome.drifts[0].level, "warn");
  assert.equal(outcome.alert, null);
  // (sanity: the helper the fixtures above lean on agrees with the same reading)
  assert.deepEqual(czk(PLANS.starter.priceCzk), [{ currency: "czk", amountMinor: PLANS.starter.priceCzk * 100 }]);
});
