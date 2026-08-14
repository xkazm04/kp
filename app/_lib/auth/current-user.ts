import { cookies } from "next/headers";
import { connection, NextResponse } from "next/server";
import { SESSION_COOKIE } from "./edge-verify";
import { verifySession, currentWorkspaceId, currentUserId, currentOrgId, isOperatorSession, DEMO_WORKSPACE, type SessionPayload } from "./session";
import { roleCapabilities, type Capability, type MemberRole } from "./roles";
import { orgAdminCapabilities, orgCapabilityCeiling, workspaceCapabilities, type MembershipGrant } from "./org-authority";
import { getMembership, capabilitiesForUserInWorkspace, listMembershipsForUser } from "../db/memberships";
import { getWorkspaceOrgId, listWorkspacesByOrg } from "../db/workspaces";

// Per-user identity + capability gate for REQUEST scope (route handlers / server
// components) — the P0 companion to require-operator.ts. require-operator answers
// "is this a trusted operator?" (binary); this answers "what can THIS user do on
// THIS team?" (capability), resolved LIVE from the DB membership (role + per-user
// overrides) so a permission change lands on the next request — no re-login. Open
// mode (no KP_OPERATOR_PASSWORD) and a password-mode operator session both fold to
// owner (full access) so local dev is unchanged.

const OWNER_CAPS = roleCapabilities("owner");
const EMPTY_CAPS: ReadonlySet<Capability> = new Set();

/** The verified session for the current request, or null. Never throws — outside a
 *  request (a background task / script) cookies() throws and we return null.
 *
 *  `await connection()` is load-bearing under Cache Components (Next 16.3): expiry
 *  verification reads the wall clock (`verifySession`'s `Date.now()` default), and
 *  the clock is an "unstable value" the prerender refuses to bake in
 *  (blocking-prerender-current-time). Reading `cookies()` no longer opts a route
 *  into request rendering the way the old model did — it only streams that subtree
 *  — so the clock read must be marked request-time explicitly, exactly as
 *  docs/01-app/01-getting-started/08-caching.md prescribes. Without it every
 *  server render that authenticates logs the error, '/' included. */
export async function currentSession(): Promise<SessionPayload | null> {
  try {
    const jar = await cookies();
    await connection();
    return verifySession(jar.get(SESSION_COOKIE)?.value);
  } catch {
    return null;
  }
}

type Caller = { authed: boolean; caps: ReadonlySet<Capability> };

async function resolveCaller(): Promise<Caller> {
  if (!process.env.KP_OPERATOR_PASSWORD) return { authed: true, caps: OWNER_CAPS }; // open dev
  const s = await currentSession();
  if (!s || currentWorkspaceId(s) === DEMO_WORKSPACE) return { authed: false, caps: EMPTY_CAPS };
  // Owner capabilities require the EXPLICIT operator marker. This used to read
  // `if (!currentUserId(s))` — i.e. it inferred operator from the absence of identity —
  // so any claim-less session was a full owner. /api/auth/switch-workspace re-minted the
  // cookie with `signSession(workspaceId)` and no claims, so any member could switch to
  // the default workspace and come back an owner.
  if (isOperatorSession(s)) return { authed: true, caps: OWNER_CAPS };
  const userId = currentUserId(s);
  // Authenticated but identity-less and not the operator: no capabilities (→ 403). Fails
  // closed, so a dropped `sub` can never be mistaken for privilege again.
  if (!userId) return { authed: true, caps: EMPTY_CAPS };
  // A valid user session with no membership on this team is authenticated but has
  // no capabilities here (→ 403, not 401).
  return { authed: true, caps: capabilitiesForUserInWorkspace(userId, currentWorkspaceId(s)) };
}

/** The signed-in principal for UI/display: identity from the session, role +
 *  effective capabilities resolved live from the current team's membership. */
export async function currentUser(): Promise<{
  userId: string | null;
  orgId: string | null;
  role: MemberRole | null;
  capabilities: Capability[];
}> {
  const s = await currentSession();
  const userId = currentUserId(s);
  const workspace = s ? currentWorkspaceId(s) : null;
  const membership = userId && workspace ? getMembership(userId, workspace) : null;
  return {
    userId,
    orgId: currentOrgId(s),
    role: membership?.role ?? null,
    capabilities: userId && workspace ? [...capabilitiesForUserInWorkspace(userId, workspace)] : [],
  };
}

export async function can(cap: Capability): Promise<boolean> {
  return (await resolveCaller()).caps.has(cap);
}

/** The caller's EFFECTIVE capability set (owner-full in open/operator mode) — what
 *  the UI reads to decide which controls to show and which permissions the actor
 *  may delegate. Distinct from currentUser().capabilities, which is session-
 *  identity-only (empty for an operator-password/open-mode caller). */
export async function callerCapabilities(): Promise<Capability[]> {
  return [...(await resolveCaller()).caps];
}

/** Route gate — usage:
 *    const denied = await requireCapability("members:manage"); if (denied) return denied;
 *  403 when authenticated but under-privileged, 401 when not authenticated. */
export async function requireCapability(cap: Capability): Promise<NextResponse | null> {
  const caller = await resolveCaller();
  if (caller.caps.has(cap)) return null;
  return NextResponse.json({ error: caller.authed ? "Forbidden" : "Unauthorized" }, { status: caller.authed ? 403 : 401 });
}

// ---- Cross-workspace authority (P2) ----------------------------------------
// resolveCaller() above answers "what can this caller do HERE?" — always against
// the session's own workspace. The workspaces console needs the other question:
// "what can this caller do on THAT workspace?", because administering seats is a
// company-level job (an admin adjusts any team) while candidate data stays
// team-private. org-authority.ts owns the policy; these two wrappers feed it the
// live DB rows. Both fail closed outside the caller's org.

/** The caller's memberships within one org (their own org), as capability grants. */
function orgMembershipGrants(userId: string, orgId: string): MembershipGrant[] {
  const orgWorkspaces = new Set(listWorkspacesByOrg(orgId).map((w) => w.id));
  return listMembershipsForUser(userId)
    .filter((m) => orgWorkspaces.has(m.workspaceId))
    .map((m) => ({ role: m.role, overrides: m.overrides }));
}

/** The caller's effective capabilities ON A SPECIFIC workspace: their membership
 *  there unioned with their org-wide ADMIN capabilities. Empty when the workspace
 *  sits outside the caller's org. Open-dev / operator sessions fold to owner, the
 *  same shortcut resolveCaller() takes. */
export async function callerWorkspaceCapabilities(workspaceId: string): Promise<ReadonlySet<Capability>> {
  if (!process.env.KP_OPERATOR_PASSWORD) return OWNER_CAPS; // open dev
  const s = await currentSession();
  if (!s) return EMPTY_CAPS;
  if (isOperatorSession(s)) return OWNER_CAPS;
  const userId = currentUserId(s);
  const orgId = currentOrgId(s);
  if (!userId || !orgId) return EMPTY_CAPS;
  // Tenant boundary: never resolve authority over another org's workspace, even
  // for an owner. An unlinked legacy workspace (org_id NULL) is treated as foreign.
  if (getWorkspaceOrgId(workspaceId) !== orgId) return EMPTY_CAPS;
  return workspaceCapabilities(capabilitiesForUserInWorkspace(userId, workspaceId), orgMembershipGrants(userId, orgId));
}

/** Route gate for a call that TARGETS one workspace. 401 unauthenticated, 403
 *  authenticated but under-privileged. A workspace outside the caller's org
 *  answers 404 — a cross-org probe must not learn that the id exists. */
export async function requireWorkspaceCapability(workspaceId: string, cap: Capability): Promise<NextResponse | null> {
  const caps = await callerWorkspaceCapabilities(workspaceId);
  if (caps.has(cap)) return null;
  const caller = await resolveCaller();
  if (!caller.authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const s = await currentSession();
  const orgId = s ? currentOrgId(s) : null;
  if (orgId && getWorkspaceOrgId(workspaceId) !== orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/** The caller's ORG-WIDE administrative capabilities — for calls that target no
 *  single workspace yet (creating one) or that decide how much of the org's
 *  workspace list to reveal. */
export async function callerOrgCapabilities(): Promise<ReadonlySet<Capability>> {
  if (!process.env.KP_OPERATOR_PASSWORD) return OWNER_CAPS; // open dev
  const s = await currentSession();
  if (!s) return EMPTY_CAPS;
  if (isOperatorSession(s)) return OWNER_CAPS;
  const userId = currentUserId(s);
  const orgId = currentOrgId(s);
  if (!userId || !orgId) return EMPTY_CAPS;
  return orgAdminCapabilities(orgMembershipGrants(userId, orgId));
}

/** Route gate for an org-wide administrative call (e.g. create a workspace). */
export async function requireOrgCapability(cap: Capability): Promise<NextResponse | null> {
  if ((await callerOrgCapabilities()).has(cap)) return null;
  const caller = await resolveCaller();
  return NextResponse.json({ error: caller.authed ? "Forbidden" : "Unauthorized" }, { status: caller.authed ? 403 : 401 });
}

/** The ceiling on what the caller may GRANT — everything they hold anywhere in
 *  their org. Feed this to `canAssignRole`, never to an access check: see the
 *  contract on `orgCapabilityCeiling`. */
export async function callerDelegationCeiling(): Promise<ReadonlySet<Capability>> {
  if (!process.env.KP_OPERATOR_PASSWORD) return OWNER_CAPS; // open dev
  const s = await currentSession();
  if (!s) return EMPTY_CAPS;
  if (isOperatorSession(s)) return OWNER_CAPS;
  const userId = currentUserId(s);
  const orgId = currentOrgId(s);
  if (!userId || !orgId) return EMPTY_CAPS;
  return orgCapabilityCeiling(orgMembershipGrants(userId, orgId));
}
