import type { BadgeTone } from "@/app/_components/Badge";
import type { BillingOverview, PlanDef } from "@/app/_lib/billing";

// Shared billing types — split out of BillingTab.tsx so BillingPlanCatalog and
// the other split-out billing components can import them without pulling in
// the tab's full render tree.

// Shape of GET /api/billing: the entitlements overview plus the static catalog
// and whether the payment provider is wired (false = unbilled local dev).
// PackDef isn't part of the billing module's public surface (index.ts), so the
// pack's wire shape is mirrored here type-only.
export type PackInfo = { id: string; name: string; meter: string; qty: number; priceCzk: number; priceUsdApprox: number };
export type BillingPayload = BillingOverview & {
  configured: boolean;
  catalog: { plans: Record<string, PlanDef>; packs: { minutes_100?: PackInfo } };
};

// Subscription lifecycle -> badge tone. Every status the webhook reducer can
// STORE (reduce.ts `SubscriptionStatus`) is enumerated here; only genuine
// provider drift falls back to neutral with the raw value labelized, never
// silently masked. `unpaid` (dunning exhausted — all retries failed, entitlement
// running out on the failed-payment grace) was missing, so the most urgent
// billing state in the system rendered with the same calm grey chip as "No
// subscription".
export const STATUS_TONE: Record<string, BadgeTone> = {
  active: "positive",
  trialing: "info",
  past_due: "caution",
  unpaid: "critical",
  canceled: "critical",
  none: "neutral",
};

/** Does this install have a metered plan at all?
 *
 *  `metered` is the DEPLOYMENT's answer, computed once on the server by
 *  `meteringActive` (app/_lib/billing/mode.ts): a payment provider is wired, OR
 *  this org already carries billing state. False means self-hosted — no
 *  subscription, no invoice, nobody to upgrade — and, downstream of the same
 *  flag, `resolvedLimit` returns null for every meter, so every allowance in the
 *  payload reads "unlimited".
 *
 *  That is why this is the honest predicate for "the allowance numbers carry no
 *  information here", and why the UI must not invent a second flag for it:
 *  `configured` is a HOSTED-deploy misconfiguration signal (a provider that
 *  should be wired and isn't), and `plan.id === "free"` is an entitlement that a
 *  paying customer can also hold mid-dunning. Only `metered` says the meters
 *  themselves are decorative.
 *
 *  Null (the overview has not landed yet) answers FALSE — metered — so a hosted
 *  deploy never flashes self-hosted chrome on its first frame. The failure
 *  direction is "a self-hoster reads the subscription wording for one frame",
 *  never "a paying customer is told they have no subscription". */
export function isUnmeteredInstall(data: Pick<BillingOverview, "metered"> | null): boolean {
  return data !== null && !data.metered;
}

// Stored subscription statuses that mean a LIVE provider subscription exists.
// MIRROR of SUBSCRIBED_STATUSES in app/_lib/billing/entitlements.ts — the wire
// payload carries the raw `status`, so the client can reproduce the server's
// rule exactly instead of guessing at it from the entitled plan.
const SUBSCRIBED_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "canceled"]);

/** How the catalog must offer a plan CHANGE: a fresh self-serve `checkout`, or the
 *  provider `portal`.
 *
 *  This has to agree with POST /api/billing/checkout's server-side guard, which
 *  403s a plan checkout when `hasActiveSubscription(state) && !cancelLapsed`. It
 *  reads the RAW stored status; the catalog used to infer it from `plan.id ===
 *  "free"`, i.e. from the ENTITLED plan — and the two disagree for every state
 *  where entitlement lapses while the provider subscription stays live. A
 *  `past_due`/`unpaid` row past the 7-day dunning grace entitles `free`, so the
 *  catalog offered "Switch to this plan" buttons that the server refuses (and must
 *  refuse — a second checkout would run in parallel with the one the MoR is still
 *  dunning and double-charge). Same for a status whose stored plan id has left the
 *  catalog: `entitledPlan` falls back to free while the subscription is active.
 *
 *  The ONE case where a lapsed subscription really does take a fresh checkout is a
 *  `canceled` (cancel-at-period-end) row whose paid period has ended: dead at the
 *  MoR, nothing left for the portal to change — the server relaxes its guard there
 *  and so does this. */
export function planChangeVia(billing: Pick<BillingOverview, "status" | "plan">): "checkout" | "portal" {
  if (!SUBSCRIBED_STATUSES.has(billing.status)) return "checkout";
  if (billing.status === "canceled" && billing.plan.id === "free") return "checkout";
  return "portal";
}
