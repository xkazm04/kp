import { test } from "node:test";
import assert from "node:assert/strict";
import { checkoutBannerState } from "./billingCheckoutBanner.ts";

// bug-ui-scan 2026-07-09 (plans-checkout #2): the banner claimed "your plan is now X" on a
// fixed 5.5s timer, asserting a grant a stale/failed provider round-trip never delivered.
// It is now bound to the real billing state: "confirmed" ONLY when the plan actually reflects.

test("no banner when this isn't a checkout return", () => {
  assert.equal(
    checkoutBannerState({ isCheckoutReturn: false, pollWindowElapsed: true, planReflectsPaid: true }),
    null,
  );
});

test("confirming while the webhook is still landing (window open, plan not yet paid)", () => {
  assert.equal(
    checkoutBannerState({ isCheckoutReturn: true, pollWindowElapsed: false, planReflectsPaid: false }),
    "confirming",
  );
});

test("confirmed ONLY once the billing state reflects a paid plan", () => {
  // Even before the poll window elapses, a reflected paid plan is a genuine success.
  assert.equal(
    checkoutBannerState({ isCheckoutReturn: true, pollWindowElapsed: false, planReflectsPaid: true }),
    "confirmed",
  );
  assert.equal(
    checkoutBannerState({ isCheckoutReturn: true, pollWindowElapsed: true, planReflectsPaid: true }),
    "confirmed",
  );
});

test("the timer alone NEVER asserts success — window elapsed but plan not reflected is 'unconfirmed'", () => {
  // This is the exact bug: the fixed timer used to flip to 'done' here and claim a plan.
  assert.equal(
    checkoutBannerState({ isCheckoutReturn: true, pollWindowElapsed: true, planReflectsPaid: false }),
    "unconfirmed",
  );
});
