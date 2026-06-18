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
  ensureDb,
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

/** THE single encoding of the "included monthly allowance first, then prepaid
 *  credits" precedence rule, shared by the read path (meterOverview's remaining)
 *  and the write path (recordMeterUsage's debit split) so the displayed remaining
 *  can never diverge from what the debit actually spends. `fromIncluded`/
 *  `fromCredits` are what spending `qty` would draw from each bucket; `remainingAfter`
 *  is what would be left (included remainder + the full credit balance). Credits are
 *  clamped to >=0 only when computing what to DEBIT (a negative ledger never funds a
 *  spend), matching the original write-path math; `remainingAfter` keeps the raw
 *  credit balance, matching the original read-path math. */
export function splitSpend(
  limit: number,
  used: number,
  credits: number,
  qty: number
): { fromIncluded: number; fromCredits: number; remainingAfter: number } {
  const includedLeft = Math.max(0, limit - used);
  const fromIncluded = Math.min(qty, includedLeft);
  const fromCredits = Math.min(Math.max(0, qty - includedLeft), Math.max(0, credits));
  const remainingAfter = Math.max(0, includedLeft - fromIncluded) + (credits - fromCredits);
  return { fromIncluded, fromCredits, remainingAfter };
}

export function meterOverview(meter: Meter, plan: PlanDef, now: Date = new Date()): MeterOverview {
  const limit = plan.limits[meter];
  const used = billingUsageFor(meter, currentPeriod(now));
  const credits = creditBalance(meter);
  return {
    meter,
    limit,
    used,
    credits,
    remaining: limit === null ? null : splitSpend(limit, used, credits, 0).remainingAfter,
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
 *  counters stay honest for analytics; enforcement is meterAllowance's job.
 *
 *  Atomic + CAS: the balance read, the split, the credit decrement and the usage
 *  increment run in ONE transaction, and the credit debit is clamped to the LIVE
 *  balance read inside that transaction — so a debit can never grant more negative
 *  credits than exist (the ledger never over-draws below zero) and a failure can't
 *  leave a half-applied debit (credits decremented but usage not incremented).
 *
 *  RESIDUAL (not closed here): the gate→debit window. A route calls meterAllowance()
 *  early and recordMeterUsage() later, with awaits between; two requests can both
 *  pass the gate at the last included unit and each do full (non-degraded) work —
 *  one extra unit of full-quality work, not a corrupted ledger. Closing that needs
 *  a reserve-then-confirm gate across the 4 call sites (analyze / interview-complete
 *  / the two devcase routes) + the failed-run refund (billing-engine #4); tracked
 *  as a follow-up. better-sqlite3 is synchronous, so the ledger itself is safe. */
export function recordMeterUsage(meter: Meter, qty: number = 1, now: Date = new Date()): void {
  if (qty <= 0) return;
  const plan = entitledPlan(getBillingState(), now);
  const limit = plan.limits[meter];
  const period = currentPeriod(now);
  const db = ensureDb();
  db.transaction(() => {
    if (limit !== null) {
      const used = billingUsageFor(meter, period);
      const balance = creditBalance(meter);
      const { fromCredits } = splitSpend(limit, used, balance, qty);
      // CAS: never debit more credits than exist at write time.
      const debit = Math.min(fromCredits, Math.max(0, balance));
      if (debit > 0) {
        grantBillingCredits({ meter, delta: -debit, reason: "consumed" });
      }
    }
    incrementBillingUsage(meter, period, qty);
  })();
}

/** Idempotent credit-back of a debited unit for a run that FAILED terminally. The
 *  debit happens at task START (e.g. /api/analyze), so a crash / spawn failure /
 *  LLM hard-fail means the customer paid for a result they never received. Keyed to
 *  the task id (billing_credits.provider_ref is UNIQUE → ON CONFLICT DO NOTHING), so
 *  a re-run or webhook-style redelivery can't double-refund. Restores the SPENDABLE
 *  balance the debit consumed: the usage counter stays (the attempt happened) and a
 *  +qty credit nets `remaining` back to its pre-debit value. */
export function refundMeterUsage(meter: Meter, taskId: string, qty: number = 1): void {
  if (qty <= 0 || !taskId) return;
  grantBillingCredits({ meter, delta: qty, reason: `refund: ${meter} run failed`, providerRef: `refund:${taskId}` });
}
