import { DEFAULT_ORG_ID } from "./db/organizations";
import {
  createUser,
  getUserByEmail,
  getUserById,
  setUserPassword,
  setUserStatus,
  updateUserName,
  listUsersByOrg,
  reapUser,
  type User,
  type UserRemovalImpact,
} from "./db/users";
import {
  upsertMembership,
  getMembership,
  listMembershipsForUser,
  listMembershipsForWorkspace,
  removeMembership,
  setMembershipOverrides,
} from "./db/memberships";
import { listWorkspacesByOrg, getWorkspaceOrgId, DEFAULT_WORKSPACE_ID } from "./db/workspaces";
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

export type InviteResult = { ok: true; invite: Invite } | { ok: false; reason: "cross_org" | "no_workspace" };

/** Create a pending invite, seated on a team of the INVITING org.
 *
 *  An invite is a deferred membership write, so it is bound by the same tenant
 *  boundary addMemberToWorkspace() enforces — but it used to skip it entirely:
 *  the caller-supplied workspaceId went through unchecked, and an absent one fell
 *  back to the global DEFAULT_WORKSPACE_ID. That constant ("workspace") is the
 *  SEEDED org's team, a hard-coded id every deployment shares, so once self-serve
 *  signup started minting real second orgs (signup-service.ts) either path seated
 *  the redeemer inside somebody else's tenant — a members:manage holder in org B
 *  could POST {"workspaceId":"workspace","role":"owner"}, redeem their own link,
 *  and read the default org's pipeline. Both paths now resolve within the org. */
export function inviteMember(input: InviteMemberInput): InviteResult {
  const orgId = input.orgId ?? DEFAULT_ORG_ID;
  let workspaceId: string;
  if (input.workspaceId) {
    if (getWorkspaceOrgId(input.workspaceId) !== orgId) return { ok: false, reason: "cross_org" };
    workspaceId = input.workspaceId;
  } else {
    // The org's OWN default team. DEFAULT_WORKSPACE_ID stays the preferred pick
    // when it belongs to this org, so the seeded single-tenant deployment keeps
    // its exact previous behaviour; any other org gets its own first team.
    const own = listWorkspacesByOrg(orgId);
    const fallback = own.find((w) => w.id === DEFAULT_WORKSPACE_ID) ?? own[0];
    if (!fallback) return { ok: false, reason: "no_workspace" };
    workspaceId = fallback.id;
  }
  return {
    ok: true,
    invite: createInvite({
      orgId,
      email: input.email,
      role: input.role,
      workspaceId,
      invitedBy: input.invitedBy ?? null,
    }),
  };
}

export type AcceptInviteInput = { token: string; name?: string | null; password: string };
// bug-ui-scan-2026-07-09 (organizations-members-invites #3): the accept flow's
// caller (the invite route) must sign the session for the team/role the invite
// just granted — not an arbitrary "first" membership. Return the accepted
// membership's workspaceId + role so the route never has to guess (it was using
// listMembershipsForUser(...)[0], the OLDEST membership, signing a re-invited
// member into their old team/role).
export type AcceptResult =
  | { ok: true; user: User; workspaceId: string; role: MemberRole }
  | { ok: false; reason: "invalid" | "weak_password" | "email_taken" | "already_active" };

/** Redeem a pending invite: activate/create the user, set their password, and add
 *  the team membership. Idempotent-ish — a redeemed invite can't be redeemed again
 *  (markInviteAccepted is guarded). */
export function acceptInvite(input: AcceptInviteInput, now: number = Date.now()): AcceptResult {
  const invite = getRedeemableInvite(input.token, now);
  if (!invite) return { ok: false, reason: "invalid" };
  if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: "weak_password" };
  // Defense in depth for the tenant boundary inviteMember() now enforces at mint
  // time: a row written BEFORE that guard (or by any other createInvite caller)
  // must never seat its redeemer on a team outside the inviting org. Checked here,
  // before any user/credential write, so a refused redeem leaves nothing behind.
  const workspaceId = invite.workspaceId ?? DEFAULT_WORKSPACE_ID;
  if (getWorkspaceOrgId(workspaceId) !== invite.orgId) return { ok: false, reason: "invalid" };

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
  // bug-ui-scan-2026-07-09 (organizations-members-invites #3): the accepted team is
  // resolved once above and returned, so the session claims match the invite (not [0]).
  upsertMembership(user.id, workspaceId, invite.role);
  markInviteAccepted(input.token, now);
  return { ok: true, user, workspaceId, role: invite.role };
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

/** How many owner-role seats one user holds across the org's teams. A sole owner
 *  who owns two teams may still be removed from one of them. */
function ownerSeatCount(orgId: string, userId: string): number {
  const orgWorkspaces = new Set(listWorkspacesByOrg(orgId).map((w) => w.id));
  return listMembershipsForUser(userId).filter((m) => m.role === "owner" && orgWorkspaces.has(m.workspaceId)).length;
}

export type MemberOpResult = { ok: boolean; reason?: "not_member" | "no_user" | "last_owner" | "no_workspace" | "cross_org" };

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

/** Add a member to a team, or change the role they already hold there (the
 *  membership is upserted on (user, workspace), so this is the one write path for
 *  both). A user may hold memberships in SEVERAL teams of their org — that is what
 *  the workspaces console manipulates — but never across orgs: the team must
 *  belong to the same organization as the user, or the write is refused. */
export function addMemberToWorkspace(userId: string, workspaceId: string, role: MemberRole): MemberOpResult {
  const user = getUserById(userId);
  if (!user) return { ok: false, reason: "no_user" };
  const orgId = getWorkspaceOrgId(workspaceId);
  if (!orgId) return { ok: false, reason: "no_workspace" };
  if (orgId !== user.orgId) return { ok: false, reason: "cross_org" };
  upsertMembership(userId, workspaceId, role);
  return { ok: true };
}

/** Remove ONE membership — the person keeps their account and every other team.
 *  The counterpart of removeMember() below, which deletes the account outright;
 *  keeping the two apart is why the console can offer "remove from this workspace"
 *  as a reversible action. Refuses when it would strip the org's last owner. */
export function removeMemberFromWorkspace(userId: string, workspaceId: string): MemberOpResult {
  const user = getUserById(userId);
  if (!user) return { ok: false, reason: "no_user" };
  const membership = getMembership(userId, workspaceId);
  if (!membership) return { ok: false, reason: "not_member" };
  // Last-owner backstop, applied to the ORG (an org with no owner can never be
  // administered again). Dropping one owner membership is fine while the same
  // person owns another team, or while somebody else owns one — so the refusal is
  // narrow: they are the org's only owner AND this is their only owner seat.
  if (membership.role === "owner" && isSoleOwner(user.orgId, userId) && ownerSeatCount(user.orgId, userId) <= 1) {
    return { ok: false, reason: "last_owner" };
  }
  removeMembership(userId, workspaceId);
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

export type RemoveMemberResult = MemberOpResult & { impact?: UserRemovalImpact };

/** Remove a member entirely (user + credentials + memberships). Refuses to remove
 *  the org's last owner — in BOTH modes: a preview against a blocked target
 *  reports the blocker, not counts.
 *
 *  `dryRun: true` computes the blast radius through the enforcement path (same
 *  deletes, executed and rolled back) and destroys nothing; the real run returns
 *  the same per-table accounting as a receipt, not a boolean. See
 *  docs/specs/2026-08-30-member-removal-blast-radius.md. */
export function removeMember(userId: string, opts?: { dryRun?: boolean }): RemoveMemberResult {
  const user = getUserById(userId);
  if (!user) return { ok: false, reason: "no_user" };
  if (isSoleOwner(user.orgId, userId)) return { ok: false, reason: "last_owner" };
  const impact = reapUser(userId, { dryRun: opts?.dryRun ?? false });
  return { ok: true, impact };
}
