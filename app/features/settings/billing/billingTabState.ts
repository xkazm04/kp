// The Billing tab's state machine, extracted from the .tsx so `node --test` can
// reach it (a component file cannot be loaded by the unit runner).
//
// Four shipped bug fixes lived inside BillingTab.tsx and useSpendData.ts as
// hand-rolled refs and inline timer arrays with no regression test: the
// newest-read latch, the once-only checkout-return capture, the single-flight
// purchase guard, and the post-checkout poll schedule. Every one of them is the
// kind of rule that reads as incidental at the call site and gets "simplified"
// away by the next edit. Here they are named, and pinned by billingTabState.test.ts.

// ---- newest-read latch -------------------------------------------------------
//
// Only the NEWEST /api/billing read may land. The checkout return fires several
// overlapping loads; without this a slow earlier response settling after a faster
// later one overwrites the fresher plan — the 2 s poll returning `free` on top of
// the 5 s poll that already returned `growth`, flipping a confirmed plan card back
// to Free with no further fetch to correct it. The same rule now covers the spend
// section's two reads, which had no latch at all: a superseded ledger failure could
// paint the section's error state over data a newer load had already delivered.

export type LoadLatch = {
  /** Claim the next sequence number for a load that is about to start. */
  begin: () => number;
  /** True only while `seq` is still the most recent claim. */
  isCurrent: (seq: number) => boolean;
};

export function createLoadLatch(): LoadLatch {
  let seq = 0;
  return {
    begin: () => (seq += 1),
    isCurrent: (candidate: number) => candidate === seq,
  };
}

// ---- single-flight purchase --------------------------------------------------

/** One catalog item at a time: which plan/pack id is checking out, and its inline
 *  error. A SUCCESSFUL checkout deliberately leaves the entry standing with a null
 *  error — the page is about to navigate to the provider-hosted form, and a button
 *  that re-enables in that gap mints a second checkout session. */
export type Purchase = { key: string; error: string | null } | null;

/** May a new checkout start? False exactly while a redirect is pending. A purchase
 *  that FAILED is not in flight, so the buyer can retry. */
export function canStartPurchase(purchase: Purchase): boolean {
  return purchase === null || purchase.error !== null;
}

/** Is THIS catalog item the one mid-redirect (button shows "Redirecting…")? */
export function isPurchaseBusy(purchase: Purchase, key: string): boolean {
  return purchase?.key === key && purchase.error === null;
}

// ---- post-checkout poll schedule --------------------------------------------
//
// Entitlement lands via the webhook a beat after the provider redirects back, so the
// tab re-reads the overview until the plan reflects it. It used to fire three FIXED
// shots (2 s, 5 s, then give up at 5.5 s) and then stop forever: a webhook delayed by
// a provider retry, a cold queue or a slow MoR left the buyer on "payment received,
// updating" with no further read and no way to ask again short of a full page reload.
//
// Now: growing delays to a STATED cap, and the banner offers a manual re-check once
// the window closes. Backoff rather than a tight interval because the thing being
// waited on is another system's delivery, not our own latency.

/** Delay before each successive re-read, in ms. Cumulative: 2s, 6s, 14s, 30s, 60s. */
export const CHECKOUT_POLL_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000, 30_000];

/** The absolute offsets (from the checkout return) at which to re-read. */
export function checkoutPollOffsetsMs(delays: readonly number[] = CHECKOUT_POLL_DELAYS_MS): number[] {
  const out: number[] = [];
  let sum = 0;
  for (const d of delays) {
    sum += d;
    out.push(sum);
  }
  return out;
}

/** How long the automatic poll window lasts before the banner hands over to the
 *  manual re-check. Derived from the schedule, never a second literal that can drift
 *  below the last shot (the old 5.5 s cut-off sat 0.5 s after the final 5 s poll,
 *  which is how "we gave up" and "we are still trying" became indistinguishable). */
export function checkoutPollWindowMs(delays: readonly number[] = CHECKOUT_POLL_DELAYS_MS): number {
  const offsets = checkoutPollOffsetsMs(delays);
  return offsets.length === 0 ? 0 : offsets[offsets.length - 1];
}

// ---- the checkout-return flag ------------------------------------------------

/** The provider redirects to `/?tab=billing&billing=success`. The flag is captured
 *  ONCE (lazy initial state) because the effect strips it from the URL immediately —
 *  a re-derivation after that would read `null` and tear the banner down mid-poll. */
export function isCheckoutReturn(billingParam: string | null): boolean {
  return billingParam === "success";
}
