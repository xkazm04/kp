import { ensureDb } from "./db/core";
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
import {
  createInvite,
  getRedeemableInvite,
  markInviteAccepted,
  revokePendingInvitesForEmail,
  type Invite,
} from "./db/invites";
import { resolveCapabilities, type Capability, type CapabilityOverride, type MemberRole } from "./auth/roles";

// Member-management service (P0) — composes the identity stores into the
// operations the Organization page + its API routes call. Guardrails live here
// (not in the route) so every caller gets them: last-owner protection, and the
// invite→accept lifecycle. The minimum accepted password length.
// One floor, owned by the credential module (wave 18a) - re-exported here so the
// signup service and the invite route keep their import path.
import { MIN_PASSWORD_LENGTH } from "./auth/password";
export { MIN_PASSWORD_LENGTH };

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
 *  the team membership.
 *
 *  ONE transaction, taken IMMEDIATE, with the redeemable read re-asserted inside it.
 *  This is a read→compute→write over four stores (invite → user → credential →
 *  membership → invite), and it used to run unlocked: two processes redeeming the
 *  same link both saw a pending invite, both wrote a password, and only the loser's
 *  `markInviteAccepted` no-op'd — so the second caller's password silently won an
 *  account the first caller had just been told was theirs, and a crash between the
 *  membership write and the mark left a member seated on a still-pending invite.
 *  Under `.immediate()` the write lock is taken at BEGIN and the invite is read
 *  behind it, so the second caller is refused structurally (`invalid`) and writes
 *  nothing. Everything here is synchronous by construction — the session signing
 *  the route does with the result stays OUTSIDE, where an await belongs. */
export function acceptInvite(input: AcceptInviteInput, now: number = Date.now()): AcceptResult {
  // A password that can never be accepted is refused before the lock is taken: a
  // form retrying "short" must not queue behind (or hold up) real redeems.
  if (!input.password || input.password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: "weak_password" };
  return ensureDb().transaction((): AcceptResult => acceptInviteLocked(input, now)).immediate();
}

/** The body of acceptInvite, running under the IMMEDIATE write lock. Every refusal
 *  it returns happens BEFORE the first write, so a refused redeem commits an empty
 *  transaction and leaves nothing behind. */
function acceptInviteLocked(input: AcceptInviteInput, now: number): AcceptResult {
  // Re-asserted INSIDE the lock — this is the check the second caller loses on.
  const invite = getRedeemableInvite(input.token, now);
  if (!invite) return { ok: false, reason: "invalid" };
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
  // Guarded on status='pending'. Under the lock this cannot fail — the invite was
  // read behind the same BEGIN IMMEDIATE — so a false here means the invariant is
  // gone; THROW rather than return, so the transaction rolls back the user,
  // credential and membership writes above instead of committing a half-redeem.
  if (!markInviteAccepted(input.token, now)) throw new Error("invite consumed concurrently under a write lock");
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

/** Thrown INSIDE a guarded transaction when the write would leave the org with no
 *  owner at all, so better-sqlite3 rolls the write back on the way out. Never
 *  escapes {@link underOwnerLock}, which converts it to the `last_owner` refusal
 *  the routes already render. */
class OwnerlessRollback extends Error {}

/** The one write path for every last-owner-guarded operation.
 *
 *  ONE `db.transaction(...)` taken IMMEDIATE, with the owner-set read performed by
 *  `body` INSIDE it. That ordering is the whole guard: `isSoleOwner` /
 *  `ownerSeatCount` are read→compute→write over `memberships`, and they used to run
 *  unlocked, so two operators demoting the org's TWO owners at the same moment both
 *  read a two-seat owner set, both concluded "not the last one", and both committed
 *  — leaving an organization nobody can administer, which is the single invariant
 *  this guard exists to protect. `acceptInvite` beside it has run under exactly this
 *  shape since the double-redeem fix; these four did not. Under BEGIN IMMEDIATE the
 *  write lock is taken before the read, so the second caller waits and then reads a
 *  one-seat owner set and is refused structurally.
 *
 *  The post-condition re-assert is the backstop, not the guard: any path that ever
 *  reaches a committed ownerless org — a future op that forgets its pre-check, a
 *  trigger, a cascade — is rolled back and answered `last_owner` instead of
 *  silently orphaning the tenant. Everything inside is synchronous by construction;
 *  never introduce an `await` here.
 *
 *  `body` returns the org whose owner set must survive (null when the operation
 *  refused before identifying one, e.g. `no_user`). */
function underOwnerLock(body: () => { result: MemberOpResult; orgId: string | null }): MemberOpResult {
  try {
    return ensureDb()
      .transaction((): MemberOpResult => {
        const { result, orgId } = body();
        if (result.ok && orgId && orgOwnerUserIds(orgId).size === 0) throw new OwnerlessRollback();
        return result;
      })
      .immediate();
  } catch (e) {
    if (e instanceof OwnerlessRollback) return { ok: false, reason: "last_owner" };
    throw e;
  }
}

/** Change a member's role on a team. Refuses to demote the org's last owner. */
export function changeMemberRole(userId: string, workspaceId: string, role: MemberRole): MemberOpResult {
  return underOwnerLock(() => {
    const user = getUserById(userId);
    if (!user) return { result: { ok: false, reason: "no_user" }, orgId: null };
    const membership = getMembership(userId, workspaceId);
    if (!membership) return { result: { ok: false, reason: "not_member" }, orgId: user.orgId };
    if (membership.role === "owner" && role !== "owner" && isSoleOwner(user.orgId, userId)) {
      return { result: { ok: false, reason: "last_owner" }, orgId: user.orgId };
    }
    upsertMembership(userId, workspaceId, role);
    return { result: { ok: true }, orgId: user.orgId };
  });
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
  return underOwnerLock(() => {
    const user = getUserById(userId);
    if (!user) return { result: { ok: false, reason: "no_user" }, orgId: null };
    const membership = getMembership(userId, workspaceId);
    if (!membership) return { result: { ok: false, reason: "not_member" }, orgId: user.orgId };
    // Last-owner backstop, applied to the ORG (an org with no owner can never be
    // administered again). Dropping one owner membership is fine while the same
    // person owns another team, or while somebody else owns one — so the refusal is
    // narrow: they are the org's only owner AND this is their only owner seat.
    if (membership.role === "owner" && isSoleOwner(user.orgId, userId) && ownerSeatCount(user.orgId, userId) <= 1) {
      return { result: { ok: false, reason: "last_owner" }, orgId: user.orgId };
    }
    removeMembership(userId, workspaceId);
    return { result: { ok: true }, orgId: user.orgId };
  });
}

/** Set a member's per-user permission overrides on a team (the "adjust permission
 *  on the user level" write path). null clears them back to role defaults. */
export function setMemberPermissions(userId: string, workspaceId: string, overrides: CapabilityOverride | null): MemberOpResult {
  if (!getMembership(userId, workspaceId)) return { ok: false, reason: "not_member" };
  setMembershipOverrides(userId, workspaceId, overrides);
  return { ok: true };
}

/** Enable/disable a member (a disabled user cannot authenticate).
 *
 *  Disabling also REVOKES the org's pending invites addressed to that email: an
 *  invite is a deferred account, so a live link left behind re-activates the very
 *  person the admin just locked out (redeem flips `users.status` back to active and
 *  writes a password only the link-holder knows). Same transaction as the status
 *  write — the seat and the way back in close together or not at all. */
export function setMemberStatus(userId: string, status: "active" | "disabled"): MemberOpResult {
  return underOwnerLock(() => {
    const user = getUserById(userId);
    if (!user) return { result: { ok: false, reason: "no_user" }, orgId: null };
    if (status === "disabled" && isSoleOwner(user.orgId, userId)) {
      return { result: { ok: false, reason: "last_owner" }, orgId: user.orgId };
    }
    setUserStatus(userId, status);
    if (status === "disabled") revokePendingInvitesForEmail(user.orgId, user.email);
    return { result: { ok: true }, orgId: user.orgId };
  });
}

export type RemoveMemberResult = MemberOpResult & { impact?: UserRemovalImpact };

/** Remove a member entirely (user + credentials + memberships) and revoke the org's
 *  pending invites addressed to their email. Refuses to remove the org's last
 *  owner — in BOTH modes: a preview against a blocked target reports the blocker,
 *  not counts.
 *
 *  `dryRun: true` computes the blast radius through the enforcement path (same
 *  deletes, executed and rolled back) and destroys nothing; the real run returns
 *  the same per-table accounting as a receipt, not a boolean. See
 *  docs/specs/2026-08-30-member-removal-blast-radius.md. */
export function removeMember(userId: string, opts?: { dryRun?: boolean }): RemoveMemberResult {
  const dryRun = opts?.dryRun ?? false;
  let impact: UserRemovalImpact | undefined;
  const result = underOwnerLock(() => {
    const user = getUserById(userId);
    if (!user) return { result: { ok: false, reason: "no_user" }, orgId: null };
    if (isSoleOwner(user.orgId, userId)) return { result: { ok: false, reason: "last_owner" }, orgId: user.orgId };
    impact = reapUser(userId, { dryRun });
    // The account is gone; the invites addressed to it are the way back in. Left
    // pending, an old link re-CREATES the user (acceptInvite's createUser branch)
    // with a fresh password and the invited role, so "removed" lasted exactly as
    // long as nobody clicked. Revoked in the SAME transaction as the reap, and
    // never on a preview: a dry run must destroy nothing, and reapUser's own
    // rollback covers only its savepoint, not this statement.
    if (!dryRun) revokePendingInvitesForEmail(user.orgId, user.email);
    return { result: { ok: true }, orgId: user.orgId };
  });
  return result.ok ? { ...result, impact } : result;
}
