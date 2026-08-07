// Plan catalog — the pricing design (memory: pricing-design / docs/features/billing/README.md)
// as code. Customer-facing meters are candidates / cases / interview minutes,
// never tokens. `null` limit = unlimited (BYOM runs text AI + voice on the
// customer's own keys, so there is nothing of ours to meter).
//
// Prices here are DISPLAY values (CZK primary, USD approximate) for the UI and
// the GET /api/billing surface; the amounts actually charged live on the
// provider's product objects (Polar products are multi-currency) — the code
// only ever references products by id.

export const METERS = ["ai_candidates", "case_designs", "interview_minutes"] as const;
export type Meter = (typeof METERS)[number];

export const PLAN_IDS = ["free", "starter", "growth", "byom", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type PlanDef = {
  id: PlanId;
  name: string;
  priceCzk: number;
  priceUsdApprox: number;
  /** Per-month included allowance per meter; null = unlimited. */
  limits: Record<Meter, number | null>;
  /** Concurrent active jobs; null = unlimited. */
  activeJobs: number | null;
  /** Contact-sales tier: custom-priced, negotiated per hiring volume — not sold
   *  through self-serve checkout. The published price is "Custom", entitlement is
   *  granted per contract, and the UI shows a "Talk to sales" path instead of a
   *  Buy button. See docs/product/enterprise-readiness.md for the capability roadmap. */
  contactSales?: boolean;
};

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free",
    name: "Free",
    priceCzk: 0,
    priceUsdApprox: 0,
    limits: { ai_candidates: 5, case_designs: 1, interview_minutes: 0 },
    activeJobs: 1,
  },
  starter: {
    id: "starter",
    name: "Starter",
    // Tuned to $10/mo (2026-07-05). CZK is the primary display currency; the app's
    // implied rate is ~24 Kč/$ (BYOM 120 Kč ≈ $5), so $10 → 240 Kč.
    priceCzk: 240,
    priceUsdApprox: 10,
    limits: { ai_candidates: 100, case_designs: 5, interview_minutes: 30 },
    activeJobs: null,
  },
  growth: {
    id: "growth",
    name: "Growth",
    // Tuned to $20/mo (2026-07-05); $20 → 480 Kč at ~24 Kč/$.
    priceCzk: 480,
    priceUsdApprox: 20,
    limits: { ai_candidates: 400, case_designs: 20, interview_minutes: 120 },
    activeJobs: null,
  },
  byom: {
    id: "byom",
    name: "BYOM",
    priceCzk: 120,
    priceUsdApprox: 5,
    limits: { ai_candidates: null, case_designs: null, interview_minutes: 0 },
    activeJobs: null,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    // Custom-priced (contactSales): the 0s are sentinels — the UI never renders a
    // number for a contact-sales tier, it renders "Custom" + a Talk-to-sales path.
    // Entitlement is granted per signed contract (a mapped Polar product or a manual
    // grant), never via self-serve checkout, so this catalog row is display-only
    // until a deal closes. Limits are unlimited: org-scale contracts aren't metered
    // like the self-serve tiers.
    priceCzk: 0,
    priceUsdApprox: 0,
    contactSales: true,
    limits: { ai_candidates: null, case_designs: null, interview_minutes: null },
    activeJobs: null,
  },
};

export type PackId = "minutes_100";

export type PackDef = {
  id: PackId;
  name: string;
  meter: Meter;
  qty: number;
  priceCzk: number;
  priceUsdApprox: number;
};

/** One-time top-up packs — sold on any tier, even BYOM without a voice key. */
export const PACKS: Record<PackId, PackDef> = {
  minutes_100: {
    id: "minutes_100",
    name: "100 interview minutes",
    meter: "interview_minutes",
    qty: 100,
    priceCzk: 790,
    priceUsdApprox: 34,
  },
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

/** A plan a customer can buy through self-serve checkout: a real paid tier that
 *  is NOT free and NOT a contact-sales (custom-priced) tier. The checkout route
 *  and the billing UI both gate on this so enterprise can never be self-served. */
export function isSelfServePlan(id: PlanId): boolean {
  return id !== "free" && !PLANS[id].contactSales;
}

export function isPackId(value: unknown): value is PackId {
  return typeof value === "string" && value in PACKS;
}

/** Monthly usage period key, UTC — 'YYYY-MM'. */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
