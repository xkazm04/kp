import { DEFAULT_ORG_ID } from "./db/organizations";
import {
  createUser,
  getUserByEmail,
  getUserById,
  setUserPassword,
  setUserStatus,
  updateUserName,
  listUsersByOrg,
  deleteUser,
  type User,
} from "./db/users";
import {
  upsertMembership,
  getMembership,
  listMembershipsForUser,
  listMembershipsForWorkspace,
  setMembershipOverrides,
} from "./db/memberships";
import { listWorkspacesByOrg, DEFAULT_WORKSPACE_ID } from "./db/workspaces";
import { createInvite, getRedeemableInvite, markInviteAccepted, type Invite } from "./db/invites";
import { resolveCapabilities, type Capability, type CapabilityOverride, type MemberRole } from "./auth/roles";

// Member-management service (P0) — composes the identity stores into the
// operations the Organization page + its API routes call. Guardrails live here
// (not in the route) so every caller gets them: last-owner protection, and the
// invite→accept lifecycle. The minimum accepted password length.
export const MIN_PASSWORD_LENGTH = 8;

export type MemberTeam = { workspaceId: string; role: MemberRole; capabilities: Capability[] };
export type OrgMember = { user: User; teams: MemberTeam[] };

/** Every member of an org with their team memberships + resolved capabilities. */
export function listOrgMembers(orgId: string = DEFAULT_ORG_ID): OrgMember[] {
  return listUsersByOrg(orgId).map((user) => ({
    user,
    teams: listMembershipsForUser(user.id).map((m) => ({
      workspaceId: m.workspaceId,
      role: m.role,
      capabilities: [...resolveCapabilities(m.role, m.overrides)],
    })),
  }));
}

// ---- Invites ---------------------------------------------------------------

export type InviteMemberInput = { orgId?: string; email: string; role: MemberRole; workspaceId?: string | null; invitedBy?: string | null };

/** Create a pending invite (defaults to the org's default team). */
export function inviteMember(input: InviteMemberInput): Invite {
  return createInvite({
    orgId: input.orgId ?? DEFAULT_ORG_ID,
    email: input.email,
    role: input.role,
    workspaceId: input.workspaceId ?? DEFAULT_WORKSPACE_ID,
    invitedBy: input.invitedBy ?? null,
  });
}

export type AcceptInviteInput = { token: string; name?: string | null; password: string };
export type AcceptResult =
  | { ok: true; user: User }
  | { ok: false; reason: "invalid" | "weak_password" | "email_taken" | "already_active" };

/** Redeem a pending invite: activate/create the user, set their password, and add
 *  the team membership. Idempotent-ish — a redeemed invite can't be redeemed again
 *  (markInviteAccepted is guarded). */
export function acceptInvite(input: AcceptInviteInput, now: number = Date.now()): AcceptResult {
  const invite = getRedeemableInvite(input.token, now);
  if (!invite) return { ok: false, reason: "invalid" };
  if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: "weak_password" };

  let user = getUserByEmail(invite.email);
  if (user) {
    // An existing account with this email must belong to the SAME org — never let
    // an invite attach another org's user (email is globally unique).
    if (user.orgId !== invite.orgId) return { ok: false, reason: "email_taken" };
    // An ACTIVE account already has an owner, a password, and a name. Redeeming an invite
    // must never overwrite them. Inviting an active member is refused at POST /api/org/invites,
    // but a pending invite issued BEFORE that account became active stays redeemable — and
    // whoever holds that link could reset the member's password and take the account over.
    // Redeem is provisioning only; an existing active user signs in instead.
    if (user.status === "active") return { ok: false, reason: "already_active" };
    setUserStatus(user.id, "active");
    setUserPassword(user.id, input.password);
    if (input.name) updateUserName(user.id, input.name);
  } else {
    user = createUser({ orgId: invite.orgId, email: invite.email, name: input.name ?? null, status: "active", password: input.password });
  }
  upsertMembership(user.id, invite.workspaceId ?? DEFAULT_WORKSPACE_ID, invite.role);
  markInviteAccepted(input.token, now);
  return { ok: true, user };
}

// ---- Role / permission changes (with last-owner protection) ----------------

/** The set of user ids holding an owner-role membership anywhere in the org — the
 *  people who can administer it. Demoting/removing the last one is refused. */
function orgOwnerUserIds(orgId: string): Set<string> {
  const owners = new Set<string>();
  for (const ws of listWorkspacesByOrg(orgId)) {
    for (const m of listMembershipsForWorkspace(ws.id)) {
      if (m.role === "owner") owners.add(m.userId);
    }
  }
  return owners;
}

function isSoleOwner(orgId: string, userId: string): boolean {
  const owners = orgOwnerUserIds(orgId);
  return owners.size === 1 && owners.has(userId);
}

export type MemberOpResult = { ok: boolean; reason?: "not_member" | "no_user" | "last_owner" };

/** Change a member's role on a team. Refuses to demote the org's last owner. */
export function changeMemberRole(userId: string, workspaceId: string, role: MemberRole): MemberOpResult {
  const user = getUserById(userId);
  if (!user) return { ok: false, reason: "no_user" };
  const membership = getMembership(userId, workspaceId);
  if (!membership) return { ok: false, reason: "not_member" };
  if (membership.role === "owner" && role !== "owner" && isSoleOwner(user.orgId, userId)) {
    return { ok: false, reason: "last_owner" };
  }
  upsertMembership(userId, workspaceId, role);
  return { ok: true };
}

/** Set a member's per-user permission overrides on a team (the "adjust permission
 *  on the user level" write path). null clears them back to role defaults. */
export function setMemberPermissions(userId: string, workspaceId: string, overrides: CapabilityOverride | null): MemberOpResult {
  if (!getMembership(userId, workspaceId)) return { ok: false, reason: "not_member" };
  setMembershipOverrides(userId, workspaceId, overrides);
  return { ok: true };
}

/** Enable/disable a member (a disabled user cannot authenticate). */
export function setMemberStatus(userId: string, status: "active" | "disabled"): MemberOpResult {
  const user = getUserById(userId);
  if (!user) return { ok: false, reason: "no_user" };
  if (status === "disabled" && isSoleOwner(user.orgId, userId)) return { ok: false, reason: "last_owner" };
  setUserStatus(userId, status);
  return { ok: true };
}

/** Remove a member entirely (user + credentials + memberships). Refuses to remove
 *  the org's last owner. */
export function removeMember(userId: string): MemberOpResult {
  const user = getUserById(userId);
  if (!user) return { ok: false, reason: "no_user" };
  if (isSoleOwner(user.orgId, userId)) return { ok: false, reason: "last_owner" };
  deleteUser(userId);
  return { ok: true };
}
