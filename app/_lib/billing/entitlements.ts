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

/** Grace window after a FAILED payment (`past_due`/`unpaid`): the workspace keeps
 *  its plan for this long past `currentPeriodEnd` while the MoR runs dunning retries,
 *  then falls to free. 7 days — long enough to ride out a transient card decline or a
 *  weekend without cutting a customer mid-work, short enough to BOUND the unpaid-
 *  entitlement leak that an indefinitely-`past_due` (or `unpaid`) subscription would
 *  otherwise create if its terminal `revoked` event were dropped. */
const FAILED_PAYMENT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Which plan the workspace is ENTITLED to right now (not just what's stored):
 *  active/trialing → the plan; past_due/unpaid → the plan through a BOUNDED dunning
 *  grace (currentPeriodEnd + FAILED_PAYMENT_GRACE_MS), then free — a failed payment
 *  can't entitle forever; canceled → the plan until the paid period ends; everything
 *  else → free. */
export function entitledPlan(state: BillingStateRow | null, now: Date = new Date()): PlanDef {
  if (!state) return PLANS.free;
  const plan = PLANS[state.plan as PlanId] ?? PLANS.free;
  if (state.status === "active" || state.status === "trialing") return plan;
  if (state.status === "past_due" || state.status === "unpaid") {
    // Failed payment: entitled only through currentPeriodEnd + grace. Unlike
    // `canceled` (paid THROUGH the period), a failed payment has no paid-through
    // guarantee, so a NULL/unparseable period anchor FAILS CLOSED to free rather than
    // leaking an unbounded entitlement — the exact leak this bound exists to stop.
    const end = state.currentPeriodEnd ? Date.parse(state.currentPeriodEnd) : NaN;
    if (!Number.isFinite(end)) return PLANS.free;
    return now.getTime() < end + FAILED_PAYMENT_GRACE_MS ? plan : PLANS.free;
  }
  if (state.status === "canceled") {
    // cancel-at-period-end: entitled until the paid period ends. Parse defensively —
    // a NULL or unparseable currentPeriodEnd must NOT silently cut a customer who
    // paid through the period. A genuinely-lapsed subscription arrives as
    // revoked/ended (→ clear_subscription → free), so a canceled row with no
    // parseable end is almost always a malformed/missing Polar field on a still-paying
    // customer: favor them and keep the plan rather than the old `&& currentPeriodEnd`
    // short-circuit that dropped them to free immediately.
    const end = state.currentPeriodEnd ? Date.parse(state.currentPeriodEnd) : NaN;
    if (!Number.isFinite(end)) return plan;
    return end > now.getTime() ? plan : PLANS.free;
  }
  return PLANS.free;
}

// Stored statuses that mean a live provider subscription EXISTS — one that must be
// changed through the customer PORTAL, never a fresh checkout. Includes the failed-
// payment states (`past_due`/`unpaid`) and `canceled` (cancel-at-period-end): all of
// these still have a Polar subscription that a second checkout would run in parallel.
const SUBSCRIBED_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "canceled"]);

/** True when a live provider subscription exists (any non-terminal status), so a
 *  plan CHANGE must go through the portal. Backs the checkout route's server-side
 *  "already subscribed" guard: a stale client tab or a crafted raw POST must not mint
 *  a second, parallel subscription and double-charge. `none`/absent (never subscribed,
 *  or fully revoked back to free) allows a fresh checkout. */
export function hasActiveSubscription(state: BillingStateRow | null): boolean {
  return Boolean(state && SUBSCRIBED_STATUSES.has(state.status));
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
  // Clamp the spendable/displayed balance at >=0: a refund claw-back (a negative
  // ledger row) that exceeds the minutes still on hand drives the raw SUM negative,
  // but a customer can never have "less than zero" credits to show or spend. The
  // ledger itself stays truthful (the negative row is a real audit record); this is
  // the single place the derived balance is floored, so `remaining` and the displayed
  // credits both stay non-negative. recordMeterUsage clamps its own debit read too.
  const credits = Math.max(0, creditBalance(meter));
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

// (refundMeterUsage removed: the AI-candidate unit is now debited on a DELIVERED,
// non-cached result inside runAnalyze — a failed/canceled/duplicate run never debits,
// so there's nothing to credit back. See app/_lib/analyze-run.ts.)
