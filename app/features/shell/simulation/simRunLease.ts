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

/** The `fetch` init for a phase-gate renew, or null when this walk holds no lease.
 *  `renew: true` is the no-purge shape of the same door: it re-asserts ownership
 *  with the token and moves the expiry, and it never touches a row. */
export function renewInit(lease: SimRunLease): RequestInit | null {
  if (!lease) return null;
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", [SIM_RUN_TOKEN_HEADER]: lease.token },
    body: JSON.stringify({ renew: true }),
  };
}

/** The `fetch` init for the walk's opening claim. A fresh Start is `{ hold: true }`,
 *  byte-identical to before: the route claims, PURGES and holds. A resume is
 *  `{ hold: true, keep: true }`: the route claims and purges nothing, so the walk it
 *  re-enters is still on the board. A resume presents the lease this tab last held
 *  (see storedLease), which is the only way to re-take a lease that is still live; a
 *  live lease under any other token refuses the claim, so a resume never steals one. */
export function claimInit(lease: SimRunLease, { keep }: { keep: boolean }): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(keep && lease ? { [SIM_RUN_TOKEN_HEADER]: lease.token } : {}) },
    body: JSON.stringify(keep ? { hold: true, keep: true } : { hold: true }),
  };
}

/** Where a tab keeps its lease across a reload. SESSION storage on purpose: it is per
 *  tab and survives a reload, so "this same browser tab" is exactly who can re-take a
 *  lease whose pagehide release was lost, and a second tab never inherits it. */
export const SIM_LEASE_STORAGE_KEY = "kp.sim.lease";

type LeaseStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The lease this tab last held, or null. Storage can be absent or throw (a private
 *  window, blocked site data); that is simply no lease, never an error. */
export function storedLease(storage: LeaseStorage | null | undefined): SimRunLease {
  try {
    const token = storage?.getItem(SIM_LEASE_STORAGE_KEY);
    return token ? { token } : null;
  } catch {
    return null; // unreadable storage: this tab proves no ownership, the server decides
  }
}

/** Remember (or, with null, forget) the lease this tab holds. Best-effort. */
export function storeLease(storage: LeaseStorage | null | undefined, lease: SimRunLease): void {
  try {
    if (lease) storage?.setItem(SIM_LEASE_STORAGE_KEY, lease.token);
    else storage?.removeItem(SIM_LEASE_STORAGE_KEY);
  } catch {
    // best-effort: a lost record only means a reload re-claims instead of re-taking
  }
}

/** This tab's session storage, or null where it is unavailable (on the server, or where
 *  the accessor itself throws with site data blocked). */
export function tabStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // blocked storage: the tab simply keeps no lease across a reload
  }
}
