// Plan catalog — the pricing design (memory: pricing-design / docs/features/billing/README.md)
// as code. Customer-facing meters are candidates / cases / interview minutes,
// never tokens. `null` limit = unlimited (BYOM runs text AI + voice on the
// customer's own keys, so there is nothing of ours to meter).
//
// Prices here are DISPLAY values (CZK primary, USD approximate) for the UI and
// the GET /api/billing surface; the amounts actually charged live on the
// provider's product objects (Polar products are multi-currency) — the code
// only ever references products by id.

// OUTCOME METERS FIRST. The headline price is what the customer got — a role taken
// to market, and a person hired — not how much compute we spent getting there.
// `ai_candidates` stays behind them as a SAFETY NET with a generous allowance:
// normal use never touches it, but it bounds a runaway (the BYOM tier already grants
// unlimited analysis on our keys with no key check, and there is no cost ledger to
// fall back on — llm_usage carries no org_id).
//
// The two outcome meters are gated DIFFERENTLY, and the difference is load-bearing:
//   job_posts  is a RECRUITER action, so it gates (402) — the same place the old
//              active-jobs cap sat, in the publish transaction.
//   hires      is a CANDIDATE action. It is DEBITED BUT NEVER GATED: a candidate
//              accepting an offer must not fail because the recruiter is over quota.
//              Overage is billed, never blocked. See offer-finalize.ts.
export const METERS = ["job_posts", "hires", "ai_candidates", "case_designs", "interview_minutes"] as const;
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
    // One role and one hire: the whole funnel is walkable end to end on Free, which
    // is the point of a trial for an outcome-priced product. A second hire is the
    // upgrade moment.
    limits: { job_posts: 1, hires: 1, ai_candidates: 25, case_designs: 1, interview_minutes: 0 },
  },
  starter: {
    id: "starter",
    name: "Starter",
    // Tuned to $10/mo (2026-07-05). CZK is the primary display currency; the app's
    // implied rate is ~24 Kč/$ (BYOM 120 Kč ≈ $5), so $10 → 240 Kč.
    priceCzk: 240,
    priceUsdApprox: 10,
    limits: { job_posts: 3, hires: 2, ai_candidates: 300, case_designs: 5, interview_minutes: 30 },
  },
  growth: {
    id: "growth",
    name: "Growth",
    // Tuned to $20/mo (2026-07-05); $20 → 480 Kč at ~24 Kč/$.
    priceCzk: 480,
    priceUsdApprox: 20,
    limits: { job_posts: 10, hires: 8, ai_candidates: 1200, case_designs: 20, interview_minutes: 120 },
  },
  byom: {
    id: "byom",
    name: "BYOM",
    priceCzk: 120,
    priceUsdApprox: 5,
    // BYOM buys unlimited COMPUTE on the customer's own keys — that is what the tier
    // means. It does not buy unlimited outcomes: roles and hires are our product, not
    // their model spend, so they carry the Starter allowance.
    limits: { job_posts: 3, hires: 2, ai_candidates: null, case_designs: null, interview_minutes: 0 },
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
    limits: { job_posts: null, hires: null, ai_candidates: null, case_designs: null, interview_minutes: null },
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
