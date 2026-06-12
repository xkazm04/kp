// Route-boundary enforcement (docs/BILLING.md → Entitlement semantics).
//
// Pure decision helpers — routes turn a non-null verdict into a 402 JSON
// response. Two enforcement shapes, by what the action costs us:
//
//   HARD GATE (402): actions that CREATE new metered work — a CV analysis run,
//   a dev-case design, an interview link, publishing a job past the plan's
//   active-job cap. Blocking these is honest; silently doing less would be
//   data the recruiter thinks exists but doesn't.
//
//   DEGRADE (--no-llm): per-candidate LLM garnish (match reasoning, automation
//   drafting) falls back to the deterministic templates — the same paths that
//   run when a provider is down — so reads never hard-fail mid-pipeline.
//
// Wire format: { error, code: "quota_exceeded", meter } — code is the stable
// branch key for the UI (i18n happens client-side), error is the English
// operator-readable fallback.

import { getBillingState } from "../db";
import { entitledPlan, meterAllowance } from "./entitlements";
import type { Meter } from "./plans";

export const QUOTA_CODE = "quota_exceeded" as const;

export type QuotaVerdict = {
  error: string;
  code: typeof QUOTA_CODE;
  meter: Meter | "active_jobs";
  plan: string;
};

const METER_LABELS: Record<Meter, string> = {
  ai_candidates: "AI candidate allowance",
  case_designs: "case design allowance",
  interview_minutes: "interview minutes",
};

/** Null = proceed; a verdict = respond 402 with it. */
export function meterGate(meter: Meter, now: Date = new Date()): QuotaVerdict | null {
  const allowance = meterAllowance(meter, now);
  if (allowance.allowed) return null;
  const plan = entitledPlan(getBillingState(), now);
  return {
    error: `This month's ${METER_LABELS[meter]} on the ${plan.name} plan is used up — upgrade or top up in Billing.`,
    code: QUOTA_CODE,
    meter,
    plan: plan.id,
  };
}

/** True when the meter still allows spending — the degrade switch for LLM
 *  garnish call sites (append --no-llm instead of blocking). */
export function meterAllows(meter: Meter, now: Date = new Date()): boolean {
  return meterAllowance(meter, now).allowed;
}

/** Active-job cap (free plan: 1). `publishedCount` = authored jobs currently
 *  'published'; seeded corpus jobs (NULL status) don't count. */
export function activeJobsGate(publishedCount: number, now: Date = new Date()): QuotaVerdict | null {
  const plan = entitledPlan(getBillingState(), now);
  if (plan.activeJobs === null || publishedCount < plan.activeJobs) return null;
  return {
    error: `The ${plan.name} plan allows ${plan.activeJobs} active job${plan.activeJobs === 1 ? "" : "s"} — close one or upgrade in Billing.`,
    code: QUOTA_CODE,
    meter: "active_jobs",
    plan: plan.id,
  };
}
