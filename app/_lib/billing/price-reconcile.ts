// Price reconciliation — the SINGLE testable encoding of the invariant "the price
// the catalog DISPLAYS must equal the price the provider CHARGES".
//
// bug-ui-scan-2026-07-09 (plans-checkout-billing-ui #4): plan/pack prices live in
// two independent sources of truth — the TS catalog (plans.ts, shown in the UI) and
// the Polar product objects (the amount actually settled) — with nothing tying them
// together. A dashboard edit or a currency mismatch silently drifts the shown price
// from the charge, a money-trust break that only surfaces after a real charge.
//
// This module is pure (no network): scripts/polar-setup.mjs fetches each product's
// live prices and feeds them here as a PREFLIGHT, warning loudly on drift. Keeping
// the logic here (not inline in the .mjs) makes the invariant unit-testable and keeps
// plans.ts the one source the script derives from.

import { PACKS } from "./plans";

/** A provider price flattened to {currency (lowercase ISO), amount in MINOR units}. */
export type ProviderPrice = { currency: string; amountMinor: number };

/** Defensively read a Polar product's fixed prices into {currency, amountMinor}
 *  tuples. Unrecognized shapes (recurring/custom/free, or a payload whose field
 *  names differ from what we expect) are skipped rather than guessed — the caller
 *  then reports "no comparable price" instead of a false drift alarm. */
export function readProviderPrices(product: unknown): ProviderPrice[] {
  const prices = (product as { prices?: unknown } | null)?.prices;
  if (!Array.isArray(prices)) return [];
  const out: ProviderPrice[] = [];
  for (const p of prices) {
    if (!p || typeof p !== "object") continue;
    const row = p as Record<string, unknown>;
    const currency = typeof row.price_currency === "string" ? row.price_currency.toLowerCase() : null;
    const amount = typeof row.price_amount === "number" ? row.price_amount : null;
    if (currency && amount !== null && Number.isFinite(amount)) out.push({ currency, amountMinor: amount });
  }
  return out;
}

export type PriceDrift = { level: "error" | "warn"; message: string };

/** Reconcile a catalog item's DISPLAYED prices against a product's live prices.
 *  CZK is the primary/authoritative display currency → exact match to the haléř
 *  (a mismatch is an `error`). USD is an approximation → a tolerance band. A CZK
 *  price the catalog shows but the product lacks is a `warn` (the customer is shown
 *  a CZK price they can't actually be charged). Returns [] when consistent. */
export function reconcileCatalogPrice(
  label: string,
  catalog: { priceCzk: number; priceUsdApprox: number },
  providerPrices: ProviderPrice[],
  opts: { usdTolerancePct?: number } = {},
): PriceDrift[] {
  const drift: PriceDrift[] = [];
  const usdTol = opts.usdTolerancePct ?? 0.1; // ±10% band for the approximate USD figure

  const czk = providerPrices.filter((p) => p.currency === "czk");
  const usd = providerPrices.filter((p) => p.currency === "usd");

  if (catalog.priceCzk > 0) {
    const expected = Math.round(catalog.priceCzk * 100);
    if (czk.length === 0) {
      drift.push({
        level: "warn",
        message: `${label}: catalog shows ${catalog.priceCzk} Kč but the product has NO CZK price`,
      });
    } else if (!czk.some((p) => p.amountMinor === expected)) {
      drift.push({
        level: "error",
        message: `${label}: catalog CZK ${catalog.priceCzk} Kč ≠ product ${czk.map((p) => p.amountMinor / 100).join("/")} Kč`,
      });
    }
  }

  if (catalog.priceUsdApprox > 0 && usd.length > 0) {
    const expected = catalog.priceUsdApprox * 100;
    const within = usd.some((p) => Math.abs(p.amountMinor - expected) <= expected * usdTol);
    if (!within) {
      drift.push({
        level: "error",
        message: `${label}: catalog ≈$${catalog.priceUsdApprox} is >${Math.round(usdTol * 100)}% off product ${usd
          .map((p) => p.amountMinor / 100)
          .join("/")} USD`,
      });
    }
  }

  return drift;
}

/** The minute-pack's USD price in minor units, DERIVED from the catalog so the setup
 *  script and the displayed price share one source (kills the old hardcoded 3400). */
export function packUsdCents(): number {
  return Math.round(PACKS.minutes_100.priceUsdApprox * 100);
}

/** The minute-pack's CZK price in minor units (haléř), from the catalog. */
export function packCzkMinor(): number {
  return Math.round(PACKS.minutes_100.priceCzk * 100);
}
