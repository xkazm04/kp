import { test } from "node:test";
import assert from "node:assert/strict";
import { planChangeVia, STATUS_TONE } from "./billingTypes.ts";
import { PLANS, type PlanDef } from "../../../_lib/billing/plans.ts";

// The catalog's "Buy" vs "Change in portal" decision MUST agree with the server-side
// guard in app/api/billing/checkout/route.ts (`hasActiveSubscription(state) &&
// !cancelLapsed` -> 403). It used to be inferred from the ENTITLED plan
// (`data.plan.id === "free"`), which diverges from the raw status for every state
// where entitlement lapses while the provider subscription stays live.

// The GET /api/billing shape this decision reads: the RAW subscription status plus
// the ENTITLED plan (entitledPlan, which is what lapses out from under the status).
const overview = (status: string, plan: PlanDef) => ({ status, plan });

test("no subscription -> a fresh checkout (the first purchase)", () => {
  assert.equal(planChangeVia(overview("none", PLANS.free)), "checkout");
});

test("a live paid plan -> the portal (a second checkout would double-charge)", () => {
  assert.equal(planChangeVia(overview("active", PLANS.growth)), "portal");
  assert.equal(planChangeVia(overview("trialing", PLANS.starter)), "portal");
});

test("a LAPSED failed payment stays portal-only — the MoR is still dunning it", () => {
  // The exact regression: past_due/unpaid past the 7-day dunning grace entitles
  // `free`, so the old `plan.id === "free"` rule offered "Switch to this plan" —
  // and billing-routes.test.ts pins the route 403ing that exact state.
  assert.equal(planChangeVia(overview("past_due", PLANS.free)), "portal");
  assert.equal(planChangeVia(overview("unpaid", PLANS.free)), "portal");
  // …and while still inside the grace, where entitlement has not lapsed yet.
  assert.equal(planChangeVia(overview("past_due", PLANS.growth)), "portal");
});

test("an active subscription on a plan id the catalog no longer carries is still portal-only", () => {
  // entitledPlan falls back to PLANS.free for an unknown stored plan; the
  // subscription is live all the same, so a fresh checkout would run in parallel.
  assert.equal(planChangeVia(overview("active", PLANS.free)), "portal");
});

test("a LAPSED cancel-at-period-end is the one relaxed case — checkout, matching the route", () => {
  // Dead at the MoR once the paid period passes: the portal has nothing left to
  // change, so a fresh checkout is the only way back and cannot double up.
  assert.equal(planChangeVia(overview("canceled", PLANS.free)), "checkout");
  // Still inside the paid period -> the subscription is live, portal.
  assert.equal(planChangeVia(overview("canceled", PLANS.growth)), "portal");
});

test("STATUS_TONE covers every status the webhook reducer can store", () => {
  // reduce.ts SubscriptionStatus + the synthesized "none". `unpaid` (dunning
  // exhausted) was missing and fell through to the same neutral chip as "no
  // subscription at all".
  for (const status of ["active", "trialing", "past_due", "unpaid", "canceled", "none"]) {
    assert.ok(STATUS_TONE[status], `${status} must map to a tone, not fall back to neutral`);
  }
  assert.notEqual(STATUS_TONE.unpaid, "neutral");
});
