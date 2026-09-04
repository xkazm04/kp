// Route-boundary enforcement (docs/features/billing/README.md → Entitlement semantics).
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
// Wire format: { error, code: "BILLING_QUOTA_EXCEEDED", meter, plan } — byte-identical
// to what `jsonRefusal("BILLING_QUOTA_EXCEEDED", 402, { meter, plan })` produces, so a
// route may return the verdict directly. The code is REGISTERED (REFUSAL_ERRORS in
// api-response.ts) and carries four catalog entries, which is the whole change: it used
// to be the unregistered string "quota_exceeded" with a hand-built English sentence
// naming the meter, so `useErrorMessage()` had nothing to resolve and every locale read
// English on the app's highest-intent upsell moment. The meter and the plan now ride
// beside the code as DATA — the reader's own sentence can name them.

import { getBillingState } from "../db/billing";
import { billingOrgForWorkspace, entitledPlan, meterAllowance, meterOverview } from "./entitlements";
import type { Meter } from "./plans";

export const QUOTA_CODE = "BILLING_QUOTA_EXCEEDED" as const;

/** The canonical English sentence for QUOTA_CODE. It is DECLARED here rather than
 *  imported because `api-response.ts` pulls in `next/server`, and this module is
 *  reachable from client components through `billing/index.ts` — so the registry
 *  cannot be imported without dragging a server module into the browser bundle.
 *  The two copies are pinned equal by `app/_lib/billing-gate.test.ts`, which CAN
 *  import both; a drift is a red test, not a wrong sentence on the wire.
 *
 *  Meter-agnostic on purpose: the meter and plan travel as data, so the reader's
 *  own catalog can compose "your AI candidate allowance on Free" in their language
 *  instead of receiving one English string per meter. */
export const QUOTA_MESSAGE =
  "This action would exceed this month’s allowance on your current plan. Upgrade or top up in Billing.";

export type QuotaVerdict = {
  error: typeof QUOTA_MESSAGE;
  code: typeof QUOTA_CODE;
  meter: Meter;
  plan: string;
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
 *  `workspace` scopes the meter read to the requesting tenant's ORG (org-plan Phase 3:
 *  a subscription is per customer company, shared across its teams — billingOrgForWorkspace).
 *  Omitted (or the default workspace) reads exactly the rows it read before — byte-identical
 *  for the single-tenant path. */
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
  // workspace's org (defaulting to the single tenant when unset).
  const orgId = billingOrgForWorkspace(opts.workspace);
  const plan = entitledPlan(getBillingState(orgId), now);
  const remaining = meterOverview(meter, plan, now, orgId).remaining;
  if (remaining === null || remaining - inFlight >= minUnits) return null;
  return {
    error: QUOTA_MESSAGE,
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
 *  garnish call sites (append --no-llm instead of blocking).
 *
 *  Takes the SAME `{ now, workspace }` options shape as meterGate above, for the
 *  same reason: the degrade decision must read the ASKING tenant's billing state.
 *  Before the workspace axis existed, every tenant's automation degrade was decided
 *  by the default workspace's plan — a second team ran on the first team's quota.
 *  Omitted, it reads exactly the row it read before (single-tenant path unchanged). */
export function meterAllows(meter: Meter, opts: { now?: Date; workspace?: string } = {}): boolean {
  return meterAllowance(meter, opts.now ?? new Date(), opts.workspace).allowed;
}

/** The publish gate, replacing the old active-job CAP.
 *
 *  Two things changed, both deliberate. It is now a METER (publishes this month)
 *  rather than a concurrency limit (roles open right now): an outcome-priced product
 *  charges for taking a role to market, and then has no business telling you how many
 *  may be open at once. And it is ORG-scoped like every other meter — the cap it
 *  replaces counted `published` jobs per WORKSPACE while reading an ORG plan, so a
 *  five-team org silently got five times the free allowance.
 *
 *  The debit is once per job EVER, not per publish: `setJobStatus` stamps
 *  `published_at = COALESCE(published_at, now)`, so closing and reopening a role does
 *  not charge again. Gate and debit both live inside the publish transaction. */
export function jobPostGate(now: Date = new Date(), workspace?: string): QuotaVerdict | null {
  return meterGate("job_posts", { now, workspace });
}
