// Portal-open outcome — the pure decision extracted from BillingTab.openPortal so
// it is unit-testable (a .tsx can't be loaded by `node --test`).
//
// bug-ui-scan-2026-07-09 (plans-checkout-billing-ui #3): the portal opened with
// `window.open` AFTER an `await`, so the click's user-activation token had usually
// expired and a popup blocker (Safari/Firefox strict, or any blocker) swallowed the
// open silently — the customer's only path to cancel/downgrade/see invoices became a
// dead, feedback-less click. The component now pre-opens the tab SYNCHRONOUSLY at
// click time (never blocked) and hands the settled `/api/billing/portal` response to
// this function to decide what happens next.

export type PortalOutcome =
  // Point the pre-opened tab at the returned portal URL.
  | { kind: "navigate"; url: string }
  // The synchronous pre-open was itself blocked (aggressive blocker): offer a
  // clickable link so the portal stays reachable instead of failing silently.
  | { kind: "fallback"; url: string }
  // 404 = no billing customer yet (a calm, expected pre-first-purchase state).
  | { kind: "hint" }
  // Any other failure (503 unconfigured, 502 gateway, malformed body).
  | { kind: "error"; message: string | null };

/** Decide the portal-open outcome from the response and whether the synchronous
 *  pre-open produced a tab. Ordering matters: 404 is the calm "no customer yet"
 *  case and must win over the generic error branch. */
export function portalOutcome(
  res: { status: number; ok: boolean; url?: string; error?: string },
  tabOpened: boolean,
): PortalOutcome {
  if (res.status === 404) return { kind: "hint" };
  if (!res.ok || !res.url) return { kind: "error", message: res.error ?? null };
  return tabOpened ? { kind: "navigate", url: res.url } : { kind: "fallback", url: res.url };
}
