// Price reconciliation — the SINGLE testable encoding of the invariant "the price
// the catalog DISPLAYS must equal the price the provider CHARGES".
//
// bug-ui-scan-2026-07-09 (plans-checkout-billing-ui #4): plan/pack prices live in
// two independent sources of truth — the TS catalog (plans.ts, shown in the UI) and
// the Polar product objects (the amount actually settled) — with nothing tying them
// together. A dashboard edit or a currency mismatch silently drifts the shown price
// from the charge, a money-trust break that only surfaces after a real charge.
//
// This module is pure (no network). TWO callers feed it: scripts/polar-setup.mjs as a
// manual PREFLIGHT (warning loudly on drift), and — since /perfect wave 38 — the
// server clock's daily pass (runPriceReconcile in sync.ts), which turns an `error`
// drift into a durable billing alert. A preflight only an operator can remember to run
// is not a guard on money the customer is being charged today; the invariant needed a
// standing check. Keeping the DECISION here (not inline in either caller) makes it
// unit-testable and keeps plans.ts the one source both derive from.

import { PACKS, PLANS } from "./plans";

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


// ---- The standing check's pure half ----------------------------------------------
//
// Split deliberately: everything below decides, and NOTHING below fetches. sync.ts
// does the network reads and the alert write; these functions are what a test can
// drive exhaustively without a provider.

/** The configured provider product ids, exactly as `PolarConfig["products"]` carries
 *  them. Declared structurally rather than imported so this module stays free of
 *  polar.ts (and of `isOffline`, which the setup script has no business loading). */
export type ConfiguredProducts = {
  starter: string | null;
  growth: string | null;
  byom: string | null;
  minutePack: string | null;
};

/** What `runPriceReconcile` needs from a gateway, and nothing more: the ids and a
 *  per-product read. Structural on purpose — a test drives the whole pass with a
 *  literal, and a second provider satisfies it without inheriting Polar's class. */
export type ReconcileSource = {
  configuredProducts(): ConfiguredProducts;
  fetchProduct(productId: string): Promise<unknown | null>;
};

/** One catalog item paired with the provider product that must charge for it. */
export type PriceTarget = {
  label: string;
  productId: string;
  catalog: { priceCzk: number; priceUsdApprox: number };
};

/** What this deployment can actually reconcile: derived from plans.ts and the ids the
 *  operator configured, so an unset product drops out on its own and a new tier is
 *  covered the day it gets a POLAR_PRODUCT_* id. A LEGACY tier (BYOM) stays in —
 *  it is withdrawn from sale but still charged to whoever holds it, which is exactly
 *  a price that must not drift unnoticed. */
export function priceTargets(products: ConfiguredProducts): PriceTarget[] {
  const out: PriceTarget[] = [];
  for (const planId of ["starter", "growth", "byom"] as const) {
    const productId = products[planId];
    if (!productId) continue;
    const plan = PLANS[planId];
    out.push({ label: plan.name, productId, catalog: { priceCzk: plan.priceCzk, priceUsdApprox: plan.priceUsdApprox } });
  }
  if (products.minutePack) {
    const pack = PACKS.minutes_100;
    out.push({
      label: pack.name,
      productId: products.minutePack,
      catalog: { priceCzk: pack.priceCzk, priceUsdApprox: pack.priceUsdApprox },
    });
  }
  return out;
}

/** The alert an operator should see, or null. */
export type ReconcileOutcome = {
  drifts: PriceDrift[];
  /** Non-null only when at least one drift is an `error`. */
  alert: { detail: string; providerRef: string } | null;
};

/** THE decision, pure. `fetched` maps a product id to the provider's product body, or
 *  to null when that read failed.
 *
 *  Two rules carry the weight:
 *  • A product we could NOT read is not drift. A network blip, an expired token or a
 *    deleted product must not raise "you are charging the wrong price" — that alarm
 *    would be a lie, and an alarm that lies gets muted.
 *  • Only an `error` alerts. A `warn` (the catalog shows a CZK price the product has
 *    no currency for) is a note the preflight prints; waking an operator daily for it
 *    would train them to ignore the channel that also carries real drift.
 *
 *  The providerRef is derived from the DRIFTING product ids, so a standing
 *  misconfiguration collapses to ONE open alert across every daily run
 *  (recordBillingAlert dedupes on an unresolved ref) while a NEW product drifting
 *  opens a new one. */
export function reconcileFetchedProducts(
  targets: readonly PriceTarget[],
  fetched: ReadonlyMap<string, unknown>,
): ReconcileOutcome {
  const drifts: PriceDrift[] = [];
  const driftingIds: string[] = [];
  for (const target of targets) {
    const product = fetched.get(target.productId);
    if (product === undefined || product === null) continue;
    const found = reconcileCatalogPrice(target.label, target.catalog, readProviderPrices(product));
    if (found.some((d) => d.level === "error")) driftingIds.push(target.productId);
    drifts.push(...found);
  }
  if (driftingIds.length === 0) return { drifts, alert: null };
  return {
    drifts,
    alert: {
      detail: drifts
        .filter((d) => d.level === "error")
        .map((d) => d.message)
        .join("; "),
      providerRef: `price-drift:${[...driftingIds].sort().join(",")}`,
    },
  };
}
