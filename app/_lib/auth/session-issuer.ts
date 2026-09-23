import type { NextResponse } from "next/server";
import { DEFAULT_WORKSPACE, ENTERED_COOKIE, SESSION_COOKIE, SESSION_TTL_MS, signSession, type SessionClaims } from "./session";
import { getUserById } from "@/app/_lib/db/users";
import { getMembership, listMembershipsForUser } from "@/app/_lib/db/memberships";
import { DEFAULT_WORKSPACE_ID, getWorkspaceOrgId, listWorkspacesByOrg } from "@/app/_lib/db/workspaces";

// THE session issuer. Every door that hands a browser a session — login (user,
// operator, open), register, invite accept, the switch-workspace renewal — mints
// here, and logout clears here. Nothing else calls signSession() or sets the session
// cookie; session-issuer.test.ts holds a source ratchet that fails the build if a
// sixth door starts minting by hand.
//
// Why one place. Five route files used to assemble their own claims and type their
// own cookie attributes, and the comments they carry record four defects that came
// from exactly that: a re-mint that dropped the claims and turned a member into an
// owner, an invite that signed the OLDEST team, an invite that forgot kp_entered, and
// a demo cookie re-minted onto the real tenant. A fifth was still live — the switch
// renewal re-minted a fresh 7-day token for a DISABLED user, because it checked
// membership (which setMemberStatus leaves in place) and never users.status.
//
// The contract, stated once:
//   • The caller names a PRINCIPAL, never claims. For a user the issuer reads the
//     users row (it must exist and not be disabled), the workspace's org (it must be
//     the user's own) and the membership (for the role). org and role on the token
//     are therefore always what the database says at mint time.
//   • A renewal is a mint. switch-workspace goes through the same checks as login,
//     so offboarding a user stops their session at the next renewal at the latest.
//   • One cookie attribute set. The values below are byte-identical to what each
//     door set by hand before this module existed (pinned by the tests).
//   • Signing can still throw when KP_SECRET is unset (open dev). The issuer signs
//     BEFORE it writes any cookie, so a throw leaves the response untouched and each
//     door keeps its own best-effort posture around it.
//
// Revocation (the unmerged per-principal list) plugs in here too: its logout calls
// clearSession(res) after writing the revocation row.

/** Who the session is for. There is deliberately no field for org, role, op or sub:
 *  those are derived, never supplied, and no member can be both operator and user. */
export type SessionPrincipal =
  /** The KP_OPERATOR_PASSWORD login. Full privilege, no per-user identity. */
  | { kind: "operator"; workspaceId?: string }
  /** No identity at all: open mode, or an identity-less session being renewed. */
  | { kind: "open"; workspaceId?: string }
  /** A real account, entering one team. */
  | { kind: "user"; userId: string; workspaceId: string };

export type IssueRefusal =
  /** users.status is 'disabled' — an offboarded account gets no new session. */
  | "inactive"
  /** The user id names no account (deleted since the cookie was minted). */
  | "unknown_user"
  /** The workspace is not in the user's own org (or does not exist). */
  | "foreign_workspace";

export type IssueResult = { ok: true; token: string } | { ok: false; reason: IssueRefusal };

export type IssueOptions = {
  now?: number;
  /** Also set the readable kp_entered marker. True for every sign-in door; false for
   *  the switch-workspace renewal, which never set it. */
  entered?: boolean;
};

const MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);
// __Host- requires Secure + Path=/ + no Domain. Secure is accepted on http://localhost
// (a trustworthy origin), so this works in dev too.
const SESSION_ATTRS = { httpOnly: true, secure: true, sameSite: "lax", path: "/" } as const;
// Not a credential — read by the pre-paint theme script and the open-mode '/' gate.
const ENTERED_ATTRS = { httpOnly: false, secure: true, sameSite: "lax", path: "/" } as const;

type Resolved = { ok: true; workspace: string; claims: SessionClaims } | { ok: false; reason: IssueRefusal };

function resolve(principal: SessionPrincipal): Resolved {
  if (principal.kind === "operator") return { ok: true, workspace: principal.workspaceId ?? DEFAULT_WORKSPACE, claims: { op: true } };
  if (principal.kind === "open") return { ok: true, workspace: principal.workspaceId ?? DEFAULT_WORKSPACE, claims: {} };
  const user = getUserById(principal.userId);
  if (!user) return { ok: false, reason: "unknown_user" };
  if (user.status === "disabled") return { ok: false, reason: "inactive" };
  if (getWorkspaceOrgId(principal.workspaceId) !== user.orgId) return { ok: false, reason: "foreign_workspace" };
  const role = getMembership(user.id, principal.workspaceId)?.role;
  return { ok: true, workspace: principal.workspaceId, claims: { sub: user.id, org: user.orgId, role } };
}

/** Mint a session for `principal` and set it on `res`. A refusal sets NO cookie. */
export function issueSession(res: NextResponse, principal: SessionPrincipal, opts: IssueOptions = {}): IssueResult {
  const resolved = resolve(principal);
  if (!resolved.ok) return resolved;
  const token = signSession(resolved.workspace, opts.now ?? Date.now(), resolved.claims);
  res.cookies.set(SESSION_COOKIE, token, { ...SESSION_ATTRS, maxAge: MAX_AGE });
  if (opts.entered !== false) markEntered(res);
  return { ok: true, token };
}

/** Set only the readable "entered the workspace" marker — the open-dev sign-in with
 *  no KP_SECRET, where no session can be signed but the '/' gate still needs to flip. */
export function markEntered(res: NextResponse): NextResponse {
  res.cookies.set(ENTERED_COOKIE, "1", { ...ENTERED_ATTRS, maxAge: MAX_AGE });
  return res;
}

/** Expire the session and the marker, with the attributes they were set with so the
 *  browser actually overwrites each. Logout, and a refused renewal. */
export function clearSession(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, "", { ...SESSION_ATTRS, maxAge: 0 });
  res.cookies.set(ENTERED_COOKIE, "", { ...ENTERED_ATTRS, maxAge: 0 });
  return res;
}

/** Where a signed-in user lands: their first team (by membership created_at) inside
 *  their OWN org; with none, the install's home workspace when it is in their org
 *  (today's behaviour for the home org); else their org's first team. Null when the
 *  org has no team at all — never another org's workspace. */
export function landingWorkspaceFor(userId: string): string | null {
  const user = getUserById(userId);
  if (!user) return null;
  const own = listMembershipsForUser(userId).find((m) => getWorkspaceOrgId(m.workspaceId) === user.orgId);
  if (own) return own.workspaceId;
  if (getWorkspaceOrgId(DEFAULT_WORKSPACE_ID) === user.orgId) return DEFAULT_WORKSPACE_ID;
  return listWorkspacesByOrg(user.orgId)[0]?.id ?? null;
}
