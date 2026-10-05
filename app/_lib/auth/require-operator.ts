import { cookies } from "next/headers";
import { connection, NextResponse } from "next/server";
import { SESSION_COOKIE } from "./edge-verify";
import { currentOrgId, currentWorkspaceId, DEMO_WORKSPACE, isOperatorSession, verifySession, type SessionPayload } from "./session";
import { isSessionRevoked } from "./session-revocation";

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
    // Clock read inside verifySession → request-time (see currentSession()).
    await connection();
    const session = verifySession(jar.get(SESSION_COOKIE)?.value);
    if (session === null) return false;
    // A public demo session (an anonymous, isolated "demo"-workspace cookie minted
    // by /api/demo) is a valid signature but is NOT an operator. The proxy gate
    // accepts any valid session, so without this an anonymous visitor's demo cookie
    // would satisfy operator-gated routes — e.g. the whole-DB export/import
    // exfiltration channel. Reject it here so those routes stay operator-only.
    if (currentWorkspaceId(session) === DEMO_WORKSPACE) return false;
    // Signed out, targeted. A stolen operator cookie is a valid signature for up to
    // seven days, and this gate is the one the provider-key writes and the whole-DB
    // export/import sit behind — so the revocation list has to be consulted HERE and
    // not only at the proxy, which is the same defense-in-depth argument the rest of
    // this file is written for. Same store, same fail-open-on-unavailable posture
    // (session-revocation.ts states why); the sibling check lives in currentSession().
    if (isSessionRevoked(session)) return false;
    return await accountStillLive(session);
  } catch {
    return false;
  }
}

/** Does the account a session NAMES still exist and still hold access? The session is a
 *  stateless 7-day token and nothing can reach into it; the account row can. Offboarding
 *  (`setUserStatus(id, "disabled")`) or deleting the account therefore has to fail the
 *  token HERE, on every request, because the signature will keep verifying until it
 *  expires. capabilitiesForUserInWorkspace() has asked this since the 7-day leak it
 *  documents; this gate did not, so a disabled member's cookie still passed every
 *  requireOperator-only route. Same predicate as the issuer and the capability read: a
 *  missing row or `disabled` is nobody.
 *
 *  A session without `sub` (the password operator, open mode, a legacy claim-less
 *  cookie) names no row and is unchanged: its only early exit is KP_SESSION_EPOCH.
 *  The data layer is imported at call time for the reason HOME_ORG_ID below spells. */
async function accountStillLive(session: SessionPayload): Promise<boolean> {
  if (!session.sub) return true;
  const { getUserById } = await import("../db/users");
  const user = getUserById(session.sub);
  return !!user && user.status !== "disabled";
}

// Returns a 401 NextResponse for the handler to return, or null to proceed:
//   const denied = await requireOperator(); if (denied) return denied;
export async function requireOperator(): Promise<NextResponse | null> {
  if (await isOperator()) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// HOME-ORG tier for deployment-wide READS (counts, queue, log tails, the llm_usage
// ledger): isOperator() admits a member of ANY org; these readers must be in the
// home org. Why, and why single-org installs are unchanged: api-contracts.md §1.2.
// Ratchet: app/api/deployment-read-gate.test.ts.

/** = db/organizations.ts DEFAULT_ORG_ID (pinned by the test); not imported, to keep
 *  the data layer out of this module's ~140 importers' graphs. */
export const HOME_ORG_ID = "org-default";

/** Open mode, the password operator, or a session whose org is absent or home. */
export function homeOrgReader(session: SessionPayload | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!env.KP_OPERATOR_PASSWORD) return true;
  if (session === null || currentWorkspaceId(session) === DEMO_WORKSPACE) return false;
  if (isOperatorSession(session)) return true;
  const org = currentOrgId(session);
  return org === null || org === HOME_ORG_ID;
}

export async function isHomeOrgReader(): Promise<boolean> {
  if (!process.env.KP_OPERATOR_PASSWORD) return true;
  try {
    const jar = await cookies();
    await connection();
    const session = verifySession(jar.get(SESSION_COOKIE)?.value);
    if (!homeOrgReader(session)) return false;
    if (session === null) return true;
    // Signed out, targeted — the same clause isOperator() carries, for the same reason.
    // The deployment-wide READS this tier gates (/diagrams, the palette preview's
    // deployment-wide tabs, the llm_usage ledger) are reachable with isHomeOrgReader
    // ALONE, i.e. with no requireOperator above them, so without this a revoked cookie
    // kept them: proxy.ts was the only check in the path, and its revocation lookup
    // fails open if its dynamic import does. Fail-open-on-store-unavailable is still
    // session-revocation.ts's documented posture.
    if (isSessionRevoked(session)) return false;
    return await accountStillLive(session);
  } catch {
    return false; // fail closed: an unreadable cookie jar is no reader
  }
}

/** 401 where requireOperator() is; a coded 403 (FORBIDDEN_CAPABILITY,
 *  "deployment:read") for another org's member; null to proceed. */
export async function requireHomeOrgReader(): Promise<NextResponse | null> {
  const signedIn = await requireOperator();
  if (signedIn) return signedIn;
  if (await isHomeOrgReader()) return null;
  return NextResponse.json({ error: "Your role does not allow this action.", code: "FORBIDDEN_CAPABILITY", capability: "deployment:read" }, { status: 403 });
}
