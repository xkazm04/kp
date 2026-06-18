import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "./edge-verify";
import { verifySession } from "./session";

// Handler-level operator gate — DEFENSE IN DEPTH for the most sensitive admin
// routes (provider-key writes, model-routing changes, the token-spending canary).
// proxy.ts already gates every non-public route when KP_OPERATOR_PASSWORD is set,
// but these routes write secrets and spawn Python, so they re-verify the session
// at the handler: a matcher gap, a route mistakenly added to the public allow-list,
// or a non-HTTP dispatch can't reach them unauthenticated.
//
// Semantics MATCH proxy.ts exactly, so there is no behavior change:
//   - KP_OPERATOR_PASSWORD unset → open mode (the app runs open by design) → allow
//   - set + valid session cookie → allow
//   - set + missing/invalid/expired → 401
//
// Boolean form of the same rule — for SERVER COMPONENTS that conditionally render
// recruiter-only controls (e.g. the Edit/Archive/Revert actions on the public JD
// page must not show to a candidate). Open mode → true (trusted local operator);
// set + valid session → true; otherwise false.
export async function isOperator(): Promise<boolean> {
  if (!process.env.KP_OPERATOR_PASSWORD) return true;
  try {
    const jar = await cookies();
    return verifySession(jar.get(SESSION_COOKIE)?.value) !== null;
  } catch {
    return false;
  }
}

// Returns a 401 NextResponse for the handler to return, or null to proceed:
//   const denied = await requireOperator(); if (denied) return denied;
export async function requireOperator(): Promise<NextResponse | null> {
  if (await isOperator()) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
