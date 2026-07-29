// Plan-price display decision — pure, so the current-plan header and the catalog
// card render from the SAME rule and can never diverge.
//
// bug-ui-scan-2026-07-09 (plans-checkout-billing-ui #5): the header branched on
// `priceCzk === 0` only, so Enterprise (a contact-sales tier whose `priceCzk` is a
// `0` sentinel) rendered as "Free" for the highest-value account. PlanCard already
// branched on `contactSales` first — this extracts that single correct rule.
//
// Precedence: contactSales wins over the `priceCzk === 0` sentinel (which is meant
// only for the genuinely-free tier).

export type PlanPriceDisplay =
  | { kind: "custom" } // contact-sales (Enterprise) → "Custom", never a CZK/USD number
  | { kind: "free" } // the genuinely free tier
  | { kind: "paid"; czk: number; usdApprox: number };

export function planPriceKind(plan: {
  contactSales?: boolean;
  priceCzk: number;
  priceUsdApprox: number;
}): PlanPriceDisplay {
  if (plan.contactSales) return { kind: "custom" };
  if (plan.priceCzk === 0) return { kind: "free" };
  return { kind: "paid", czk: plan.priceCzk, usdApprox: plan.priceUsdApprox };
}
