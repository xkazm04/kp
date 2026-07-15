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
import { entitledPlan, meterAllowance, meterOverview } from "./entitlements";
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

/** Null = proceed; a verdict = respond 402 with it.
 *
 *  `minUnits` is the WORST-CASE number of units this single action can consume
 *  (default 1) — it must equal the most the later debit can charge, not the typical
 *  or default amount. Example of the bug this closes: an interview books ~20 minutes
 *  but /complete debits up to 2× the booked length (`maxBillableInterviewMin`); a gate
 *  that reserved the 20-min constant let a near-cap meter run a 40–60 min call whose
 *  un-funded overage landed as billing_usage on the most expensive meter. Gate on
 *  `remaining - inFlight >= minUnits`.
 *
 *  `inFlight` is units already RESERVED by not-yet-debited work in progress — e.g.
 *  queued/running analyze tasks that each debit one unit at delivery, seconds after
 *  their submit passed this gate. Subtracting them closes the check-then-act window:
 *  without it, N concurrent submits all read the same pre-debit `remaining`, all pass,
 *  and collectively overrun a hard cap. Callers count the in-flight reservations and
 *  MUST leave no `await` between that count and the reservation's creation (the task-row
 *  insert), so under better-sqlite3's synchronous writes no request interleaves in the
 *  gap. A null (unlimited) allowance always proceeds.
 *
 *  `workspace` scopes the meter read to the requesting tenant (tenancy arc). Omitted
 *  (or the default workspace) reads exactly the row it read before — byte-identical for
 *  the single-tenant path — so this only starts to differ once per-tenant billing exists. */
export function meterGate(
  meter: Meter,
  opts: { now?: Date; minUnits?: number; inFlight?: number; workspace?: string } = {}
): QuotaVerdict | null {
  const now = opts.now ?? new Date();
  const minUnits = Math.max(1, Math.floor(opts.minUnits ?? 1));
  const inFlight = Math.max(0, Math.floor(opts.inFlight ?? 0));
  // Resolve the entitled plan ONCE: the allowance check and the verdict's plan
  // label both read it, and a single billing_state read also can't observe two
  // different rows under a concurrent webhook write. Scoped to the requesting
  // workspace (defaulting to the single tenant when unset).
  const plan = entitledPlan(getBillingState(opts.workspace), now);
  const remaining = meterOverview(meter, plan, now).remaining;
  if (remaining === null || remaining - inFlight >= minUnits) return null;
  return {
    error: `This month's ${METER_LABELS[meter]} on the ${plan.name} plan won't cover this action — upgrade or top up in Billing.`,
    code: QUOTA_CODE,
    meter,
    plan: plan.id,
  };
}

/** The most interview minutes ONE session can debit at /complete: that route clamps
 *  the billed wall-clock time to `[1, bookedMin*2]`, so this 2× ceiling is exactly the
 *  amount /create must RESERVE up front. Single-sourced here so the create-time gate
 *  and the complete-time debit can never read different numbers — the gate/debit
 *  divergence was the whole bug (the gate reserved a 20-min constant while the debit
 *  clamped to the session's own 2× length). `bookedMin` is the session's booked
 *  duration (the caller already applies its own default). */
export function maxBillableInterviewMin(bookedMin: number): number {
  return Math.max(0, Math.floor(Number(bookedMin) || 0)) * 2;
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
