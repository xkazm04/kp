export type CheckoutBanner = "confirming" | "confirmed" | "unconfirmed" | null;

/** The post-checkout return banner, bound to the ACTUAL billing state rather than a fixed
 *  timer. bug-ui-scan 2026-07-09 (plans-checkout #2): the old banner flipped to "your plan
 *  is now X" on a 5.5 s setTimeout, so it asserted a plan grant a stale/failed provider
 *  round-trip never delivered.
 *
 *  We now only claim success (`confirmed`) once `/api/billing` actually reflects a paid
 *  plan. While the webhook is still landing we show `confirming`; if the poll window
 *  elapses and the plan still isn't reflected (a slow webhook, or a minute-pack purchase
 *  that doesn't change the plan) we show a neutral `unconfirmed` ("payment received,
 *  updating") — never a false "your plan is now X". */
export function checkoutBannerState(input: {
  isCheckoutReturn: boolean;
  pollWindowElapsed: boolean;
  planReflectsPaid: boolean;
}): CheckoutBanner {
  if (!input.isCheckoutReturn) return null;
  if (input.planReflectsPaid) return "confirmed";
  if (input.pollWindowElapsed) return "unconfirmed";
  return "confirming";
}
