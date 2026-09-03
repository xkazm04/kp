// The Billing tab's state machine — four shipped bug fixes that had no regression
// test until now (they lived as refs and inline timer arrays inside BillingTab.tsx,
// which `node --test` cannot load).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canStartPurchase,
  CHECKOUT_POLL_DELAYS_MS,
  checkoutPollOffsetsMs,
  checkoutPollWindowMs,
  createLoadLatch,
  isCheckoutReturn,
  isPurchaseBusy,
} from "./billingTabState.ts";

// ---- the newest-read latch ---------------------------------------------------

test("only the newest load may land — a slow earlier read cannot overwrite a fresher one", () => {
  const latch = createLoadLatch();
  const first = latch.begin();
  const second = latch.begin();
  // The checkout return fires overlapping loads; the 2 s poll settles AFTER the 5 s
  // one. Without the latch it would repaint `free` over the confirmed `growth`.
  assert.equal(latch.isCurrent(second), true);
  assert.equal(latch.isCurrent(first), false, "a superseded read must be dropped, not applied");
});

test("a superseded read's FAILURE is dropped too — it is not this view's failure", () => {
  const latch = createLoadLatch();
  const stale = latch.begin();
  latch.begin();
  // The old code set `loadFailed` from any rejected fetch. A newer load already owns
  // the outcome, so a stale rejection must not paint an error over live data.
  assert.equal(latch.isCurrent(stale), false);
});

test("each latch is independent — the tab's reads and the spend section's do not interfere", () => {
  const tab = createLoadLatch();
  const spend = createLoadLatch();
  const tabSeq = tab.begin();
  spend.begin();
  spend.begin();
  assert.equal(tab.isCurrent(tabSeq), true, "another surface's reads must not invalidate this one's");
});

// ---- single-flight purchase --------------------------------------------------

test("a checkout mid-redirect blocks a second one; a FAILED one does not", () => {
  assert.equal(canStartPurchase(null), true, "nothing in flight");
  assert.equal(
    canStartPurchase({ key: "starter", error: null }),
    false,
    "the page is about to navigate to the provider form — a second click would mint a second session"
  );
  assert.equal(canStartPurchase({ key: "starter", error: "Checkout failed" }), true, "a failure must be retryable");
});

test("only the item actually checking out reads as busy", () => {
  const purchase = { key: "growth", error: null };
  assert.equal(isPurchaseBusy(purchase, "growth"), true);
  assert.equal(isPurchaseBusy(purchase, "starter"), false, "one spinner, not a whole disabled catalog");
  assert.equal(isPurchaseBusy({ key: "growth", error: "nope" }, "growth"), false);
  assert.equal(isPurchaseBusy(null, "growth"), false);
});

// ---- the poll schedule -------------------------------------------------------

test("the poll backs off and its window is DERIVED from the last shot, never a second literal", () => {
  assert.deepEqual(checkoutPollOffsetsMs([2_000, 4_000, 8_000]), [2_000, 6_000, 14_000]);
  assert.equal(checkoutPollWindowMs([2_000, 4_000, 8_000]), 14_000);
  // The old code gave up 0.5 s after its final poll, so "we gave up" and "we are
  // still trying" were indistinguishable. The window must END on a read.
  const offsets = checkoutPollOffsetsMs();
  assert.equal(checkoutPollWindowMs(), offsets[offsets.length - 1]);
});

test("the schedule strictly grows and reaches a stated cap of one minute", () => {
  for (let i = 1; i < CHECKOUT_POLL_DELAYS_MS.length; i += 1) {
    assert.ok(
      CHECKOUT_POLL_DELAYS_MS[i] > CHECKOUT_POLL_DELAYS_MS[i - 1],
      "a webhook delayed by a provider retry must not be hammered at a fixed interval"
    );
  }
  assert.equal(checkoutPollWindowMs(), 60_000, "the cap is stated, and the banner then offers a manual re-check");
  assert.ok(CHECKOUT_POLL_DELAYS_MS.length > 3, "strictly more reads than the three fixed shots it replaces");
});

test("an empty schedule degrades to a zero window rather than reading past the end", () => {
  assert.deepEqual(checkoutPollOffsetsMs([]), []);
  assert.equal(checkoutPollWindowMs([]), 0);
});

// ---- the return flag ---------------------------------------------------------

test("only ?billing=success is a checkout return", () => {
  assert.equal(isCheckoutReturn("success"), true);
  assert.equal(isCheckoutReturn("cancelled"), false);
  // After the effect strips the param, a RE-derivation would read null — which is
  // exactly why the tab captures this once, in lazy initial state.
  assert.equal(isCheckoutReturn(null), false);
});
