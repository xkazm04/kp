// Entitlement resolution + usage accounting over the billing_* tables.
//
// The product contract is DEGRADE, NOT BLOCK: when an allowance runs out, LLM
// call sites switch to their deterministic fallbacks (the same paths that run
// when a provider is down) — reads never hard-fail. meterAllowance() is the
// question routes ask before spending; recordMeterUsage() is the debit.
//
// Accounting model: each plan grants a monthly included allowance per meter
// (billing_usage counts the month's consumption); prepaid packs live in the
// billing_credits ledger and are consumed one unit at a time only AFTER the
// monthly allowance is exhausted (a negative ledger row per unit), so the
// balance survives month boundaries without double counting.

import {
  billingUsageFor,
  creditBalance,
  getBillingState,
  grantBillingCredits,
  incrementBillingUsage,
  type BillingStateRow,
} from "../db";
import { currentPeriod, PLANS, type Meter, type PlanDef, type PlanId } from "./plans";

/** Which plan the workspace is ENTITLED to right now (not just what's stored):
 *  active/trialing → the plan; past_due → the plan (the MoR runs dunning — a
 *  short grace beats cutting a paying customer mid-retry); canceled → the plan
 *  until the paid period ends; everything else → free. */
export function entitledPlan(state: BillingStateRow | null, now: Date = new Date()): PlanDef {
  if (!state) return PLANS.free;
  const plan = PLANS[state.plan as PlanId] ?? PLANS.free;
  if (state.status === "active" || state.status === "trialing" || state.status === "past_due") return plan;
  if (state.status === "canceled" && state.currentPeriodEnd && new Date(state.currentPeriodEnd) > now) {
    return plan;
  }
  return PLANS.free;
}

export type MeterOverview = {
  meter: Meter;
  limit: number | null;
  used: number;
  credits: number;
  /** Units still spendable this month (included remainder + credits); null = unlimited. */
  remaining: number | null;
};

export type BillingOverview = {
  plan: PlanDef;
  status: string;
  periodEnd: string | null;
  provider: string | null;
  meters: MeterOverview[];
};

export function meterOverview(meter: Meter, plan: PlanDef, now: Date = new Date()): MeterOverview {
  const limit = plan.limits[meter];
  const used = billingUsageFor(meter, currentPeriod(now));
  const credits = creditBalance(meter);
  return {
    meter,
    limit,
    used,
    credits,
    remaining: limit === null ? null : Math.max(0, limit - used) + credits,
  };
}

export function billingOverview(now: Date = new Date()): BillingOverview {
  const state = getBillingState();
  const plan = entitledPlan(state, now);
  return {
    plan,
    status: state?.status ?? "none",
    periodEnd: state?.currentPeriodEnd ?? null,
    provider: state?.provider ?? null,
    meters: (Object.keys(plan.limits) as Meter[]).map((meter) => meterOverview(meter, plan, now)),
  };
}

export type Allowance = { allowed: boolean; remaining: number | null; reason?: "limit_reached" };

/** Ask before spending. Unlimited meters always allow; otherwise allowance =
 *  included remainder + credit balance. Callers degrade to deterministic mode
 *  when not allowed — never hard-block. */
export function meterAllowance(meter: Meter, now: Date = new Date()): Allowance {
  const overview = meterOverview(meter, entitledPlan(getBillingState(), now), now);
  if (overview.remaining === null) return { allowed: true, remaining: null };
  if (overview.remaining > 0) return { allowed: true, remaining: overview.remaining };
  return { allowed: false, remaining: 0, reason: "limit_reached" };
}

/** Debit `qty` units: the month's included allowance first, then prepaid
 *  credits (one negative ledger row per overflow unit, so the balance is live
 *  and survives month boundaries). Records usage even past empty — the
 *  counters stay honest for analytics; enforcement is meterAllowance's job. */
export function recordMeterUsage(meter: Meter, qty: number = 1, now: Date = new Date()): void {
  if (qty <= 0) return;
  const plan = entitledPlan(getBillingState(), now);
  const limit = plan.limits[meter];
  const period = currentPeriod(now);
  if (limit !== null) {
    const used = billingUsageFor(meter, period);
    const includedLeft = Math.max(0, limit - used);
    const fromCredits = Math.min(Math.max(0, qty - includedLeft), Math.max(0, creditBalance(meter)));
    if (fromCredits > 0) {
      grantBillingCredits({ meter, delta: -fromCredits, reason: "consumed" });
    }
  }
  incrementBillingUsage(meter, period, qty);
}
