import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "./edge-verify";
import { verifySession, currentWorkspaceId, currentUserId, currentOrgId, DEMO_WORKSPACE, type SessionPayload } from "./session";
import { roleCapabilities, type Capability, type MemberRole } from "./roles";
import { getMembership, capabilitiesForUserInWorkspace } from "../db/memberships";

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
 *  request (a background task / script) cookies() throws and we return null. */
export async function currentSession(): Promise<SessionPayload | null> {
  try {
    const jar = await cookies();
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
  const userId = currentUserId(s);
  if (!userId) return { authed: true, caps: OWNER_CAPS }; // operator-password session = owner
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

/** Route gate — usage:
 *    const denied = await requireCapability("members:manage"); if (denied) return denied;
 *  403 when authenticated but under-privileged, 401 when not authenticated. */
export async function requireCapability(cap: Capability): Promise<NextResponse | null> {
  const caller = await resolveCaller();
  if (caller.caps.has(cap)) return null;
  return NextResponse.json({ error: caller.authed ? "Forbidden" : "Unauthorized" }, { status: caller.authed ? 403 : 401 });
}
