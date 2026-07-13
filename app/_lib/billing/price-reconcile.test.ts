import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readProviderPrices,
  reconcileCatalogPrice,
  packUsdCents,
  packCzkMinor,
} from "./price-reconcile.ts";
import { PACKS } from "./plans.ts";

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

test("pack price helpers derive from the catalog (one source of truth)", () => {
  assert.equal(packUsdCents(), PACKS.minutes_100.priceUsdApprox * 100);
  assert.equal(packCzkMinor(), PACKS.minutes_100.priceCzk * 100);
  assert.equal(packUsdCents(), 3400); // matches the value polar-setup used to hardcode
});
