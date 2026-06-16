// Plan catalog — the pricing design (memory: pricing-design / docs/BILLING.md)
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

export const PLAN_IDS = ["free", "starter", "growth", "byom"] as const;
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
    priceCzk: 490,
    priceUsdApprox: 21,
    limits: { ai_candidates: 100, case_designs: 5, interview_minutes: 30 },
    activeJobs: null,
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceCzk: 1190,
    priceUsdApprox: 50,
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

export function isPackId(value: unknown): value is PackId {
  return typeof value === "string" && value in PACKS;
}

/** Monthly usage period key, UTC — 'YYYY-MM'. */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
