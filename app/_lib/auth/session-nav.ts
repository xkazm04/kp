"use client";

// Client entry/exit for the workspace — the real-session replacement for the old
// localStorage dev gate. The landing's sign-in CTAs call enterWorkspace(); the
// sidebar's sign-out calls leaveWorkspace().

/** Enter the workspace from the public landing. Posts to the login endpoint with
 *  NO credentials:
 *   - open mode (no KP_OPERATOR_PASSWORD): the endpoint sets the entry marker (and
 *     a session when KP_SECRET is set) and we reload onto the dashboard;
 *   - password mode: the empty POST is rejected (401), so we hand off to the
 *     /login form for the real sign-in.
 *  A hard navigation (not a client swap) so the pre-paint theme script re-runs
 *  with the new entered state.
 *
 *  `plan` carries the pricing tier the visitor picked (landing-marketing #1). The
 *  tier buttons used to call this with no argument, so the single highest-intent
 *  signal on the marketing surface was silently discarded. We persist it as a
 *  `?plan=` query param on the entered/login URL so billing can preselect the plan
 *  and analytics can attribute the intent. */
export async function enterWorkspace(plan?: string): Promise<void> {
  const query = plan ? `?plan=${encodeURIComponent(plan)}` : "";
  try {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    window.location.assign(r.ok ? `/${query}` : `/login${query}`);
  } catch {
    // Network/offline — fall back to the sign-in form (keep the plan intent).
    window.location.assign(`/login${query}`);
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
