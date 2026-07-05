import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "./edge-verify";
import { verifySession, currentWorkspaceId, currentUserId, currentOrgId, DEMO_WORKSPACE, type SessionPayload } from "./session";
import { isMemberRole, roleCan, roleAtLeast, type Capability, type MemberRole } from "./roles";

// Per-user identity + role gate for REQUEST scope (route handlers / server
// components) — the P0 companion to require-operator.ts. require-operator answers
// "is this a trusted operator?" (binary); this answers "what can THIS user do?"
// (capability). Both fold open mode (no KP_OPERATOR_PASSWORD) into full access so
// local dev is unchanged.

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

/** The signed-in principal: user id / org id / role, each null when the session
 *  carries no per-user identity (operator-password or open mode). */
export async function currentUser(): Promise<{ userId: string | null; orgId: string | null; role: MemberRole | null }> {
  const s = await currentSession();
  return {
    userId: currentUserId(s),
    orgId: currentOrgId(s),
    role: isMemberRole(s?.role) ? (s!.role as MemberRole) : null,
  };
}

/** The caller's EFFECTIVE role for capability checks:
 *  - open mode (no KP_OPERATOR_PASSWORD): 'owner' — trusted local dev, unchanged.
 *  - a per-user session: its membership role.
 *  - a password-mode operator session (no role): 'owner' — the sole operator is admin.
 *  - a demo session, or no/invalid session in password mode: null (unauthorized). */
export async function effectiveRole(): Promise<MemberRole | null> {
  if (!process.env.KP_OPERATOR_PASSWORD) return "owner";
  const s = await currentSession();
  if (!s || currentWorkspaceId(s) === DEMO_WORKSPACE) return null;
  return isMemberRole(s.role) ? s.role : "owner";
}

export async function can(cap: Capability): Promise<boolean> {
  return roleCan(await effectiveRole(), cap);
}

export async function atLeast(min: MemberRole): Promise<boolean> {
  return roleAtLeast(await effectiveRole(), min);
}

/** Route gate — usage:
 *    const denied = await requireCapability("members:manage"); if (denied) return denied;
 *  403 when authenticated but under-privileged, 401 when not authenticated. */
export async function requireCapability(cap: Capability): Promise<NextResponse | null> {
  const role = await effectiveRole();
  if (roleCan(role, cap)) return null;
  return NextResponse.json({ error: role ? "Forbidden" : "Unauthorized" }, { status: role ? 403 : 401 });
}
