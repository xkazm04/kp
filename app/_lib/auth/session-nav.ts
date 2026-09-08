"use client";

// Client entry/exit for the workspace — the real-session replacement for the old
// localStorage dev gate. The landing's sign-in CTAs call enterWorkspace(); the
// sidebar's sign-out calls leaveWorkspace().

import { track } from "../analytics/track";

/** Enter the workspace from the public landing. Posts to the login endpoint with
 *  NO credentials:
 *   - open mode (no KP_OPERATOR_PASSWORD): the endpoint sets the entry marker (and
 *     a session when KP_SECRET is set) and we reload onto the dashboard;
 *   - password mode: the empty POST is rejected (401), so we hand off to a real
 *     sign-in surface — `/login` by default, `/signup` when the caller says the
 *     deploy has self-serve signup open (see `opts.fallback` below).
 *  A hard navigation (not a client swap) so the pre-paint theme script re-runs
 *  with the new entered state.
 *
 *  `plan` carries the pricing tier the visitor picked (landing-marketing #1). The
 *  tier buttons used to call this with no argument, so the single highest-intent
 *  signal on the marketing surface was silently discarded. We persist it as a
 *  `?plan=` query param on the entered/login URL so billing can preselect the plan
 *  and analytics can attribute the intent.
 *
 *  `opts.fallback` chooses WHICH sign-in surface the refusal hands off to. The
 *  default `/login` assumes the visitor already has an account — true for an
 *  operator, false for the cold prospect the landing hero is written for. A
 *  deploy that opened self-serve signup (`KP_SIGNUP_ENABLED`, read server-side by
 *  `workspace-lock.signupEnabled` and passed down to the landing as a prop) can
 *  therefore ask for `/signup` instead, so "Start hiring free" lands somewhere a
 *  stranger can actually finish. The env is never re-parsed here: the client only
 *  ever sees the resolved choice. */
export type EnterWorkspaceOptions = {
  /** Where to hand off when the credential-less POST is refused (a gated deploy)
   *  or the network is gone. Only the two real sign-in surfaces are accepted. */
  fallback?: "/login" | "/signup";
};

export async function enterWorkspace(plan?: string, opts?: EnterWorkspaceOptions): Promise<void> {
  const query = plan ? `?plan=${encodeURIComponent(plan)}` : "";
  const fallback = opts?.fallback ?? "/login";
  // Fire-and-forget, before the hard navigation below — the picked pricing tier
  // is the highest-intent signal on the marketing surface. No-op when Plausible
  // isn't configured/loaded; never awaited, never allowed to delay entry.
  track("workspace_entered", plan ? { plan } : undefined);
  try {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    window.location.assign(r.ok ? `/${query}` : `${fallback}${query}`);
  } catch {
    // Network/offline — fall back to the sign-in form (keep the plan intent).
    window.location.assign(`${fallback}${query}`);
  }
}

/** Leave the workspace: expire the session + entry marker, return to the landing.
 *  Best-effort — a failed logout POST still navigates home, where the gate re-reads
 *  the (now absent or soon-expired) cookies. */
export async function leaveWorkspace(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* network/offline — navigate home anyway */
  }
  window.location.assign("/");
}
