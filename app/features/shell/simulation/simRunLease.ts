// The guided walk's side of the run LEASE (/perfect wave 44) — pure, so the rule
// that actually bit is testable without a browser.
//
// The bug: the walk claimed the workspace's run lock inside its `try` and released
// it in a `finally` that fired unconditionally. A second tab whose claim was
// REFUSED with SIM_RUN_ACTIVE (409) still ran that `finally`, and the wave-22 route
// released whoever held the lock — so the refused tab freed the WINNER's lease and
// the next press wiped a live run. Two rules, both here:
//
//   1. A release is sent only for a lease this walk actually claimed. No token, no
//      request (`releaseInit` returns null and the `finally` does nothing).
//   2. Every release and renew presents the token, and the route re-asserts it.
//
// The token is minted server-side (sim-store `beginSimRun`) and is never derivable
// from the workspace id, so tracking it here is what makes ownership real rather
// than advisory.

/** The header the lease token rides on. ONE definition, imported by both the walk
 *  and `app/api/sim/reset/route.ts`; a header keeps the token out of the URL (and
 *  out of access logs) without giving DELETE a body. */
export const SIM_RUN_TOKEN_HEADER = "x-sim-run-token";

/** What a walk holds between the claim and the release: the token, or nothing when
 *  the claim was refused or answered without one (an older server). */
export type SimRunLease = { token: string } | null;

/** Read the lease out of a `POST /api/sim/reset { hold: true }` response body.
 *  Anything that is not a non-empty string token is NO lease — a walk that cannot
 *  prove ownership must not try to release someone else's. */
export function leaseFromClaim(body: unknown): SimRunLease {
  if (typeof body !== "object" || body === null) return null;
  const token = (body as { token?: unknown }).token;
  return typeof token === "string" && token.length > 0 ? { token } : null;
}

/** The `fetch` init for the end-of-run release, or null when there is nothing to
 *  release. Returning null IS the fix for the refused-start case: the `finally` has
 *  no request to send. */
export function releaseInit(lease: SimRunLease): RequestInit | null {
  if (!lease) return null;
  return { method: "DELETE", headers: { [SIM_RUN_TOKEN_HEADER]: lease.token } };
}
