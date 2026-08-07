import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { DEFAULT_ORG_ID } from "./db/organizations.ts";
import { createWorkspace } from "./db/workspaces.ts";
import { verifyCredentials, getUserByEmail } from "./db/users.ts";
import {
  listOrgMembers,
  inviteMember,
  acceptInvite,
  changeMemberRole,
  removeMember,
  setMemberPermissions,
  setMemberStatus,
} from "./org-service.ts";

after(() => cleanupUnitDb());

test("listOrgMembers returns the seeded ČS roster with resolved capabilities", () => {
  const byEmail = new Map(listOrgMembers(DEFAULT_ORG_ID).map((m) => [m.user.email, m]));
  const petra = byEmail.get("petra.novakova@csas.cz")!;
  assert.equal(petra.teams[0].role, "owner");
  assert.ok(petra.teams[0].capabilities.includes("org:manage"));
  const marketa = byEmail.get("marketa.svobodova@csas.cz")!;
  assert.equal(marketa.teams[0].role, "recruiter");
  assert.ok(marketa.teams[0].capabilities.includes("pipeline:write"));
  assert.ok(!marketa.teams[0].capabilities.includes("members:manage"));
});

test("invite → accept creates an active, authenticatable member on the default team", () => {
  const invite = inviteMember({ email: "new.hire@csas.cz", role: "recruiter", invitedBy: "usr-seed-petra" });
  assert.equal(invite.status, "pending");
  assert.deepEqual(acceptInvite({ token: invite.token, password: "short" }), { ok: false, reason: "weak_password" });
  assert.equal(acceptInvite({ token: invite.token, name: "New Hire", password: "a-strong-pw" }).ok, true);
  assert.ok(verifyCredentials("new.hire@csas.cz", "a-strong-pw"));
  // Single-use.
  assert.deepEqual(acceptInvite({ token: invite.token, password: "a-strong-pw" }), { ok: false, reason: "invalid" });
  assert.equal(listOrgMembers().find((m) => m.user.email === "new.hire@csas.cz")!.teams[0].role, "recruiter");
});

test("accepting an invite activates an already-invited seeded user", () => {
  assert.equal(getUserByEmail("lucie.markova@csas.cz")!.status, "invited");
  const invite = inviteMember({ email: "lucie.markova@csas.cz", role: "recruiter" });
  assert.equal(acceptInvite({ token: invite.token, password: "lucie-pw-123" }).ok, true);
  assert.equal(getUserByEmail("lucie.markova@csas.cz")!.status, "active");
  assert.ok(verifyCredentials("lucie.markova@csas.cz", "lucie-pw-123"));
});

test("the org's last owner cannot be demoted, disabled, or removed", () => {
  assert.deepEqual(changeMemberRole("usr-seed-petra", "workspace", "admin"), { ok: false, reason: "last_owner" });
  assert.deepEqual(setMemberStatus("usr-seed-petra", "disabled"), { ok: false, reason: "last_owner" });
  assert.deepEqual(removeMember("usr-seed-petra"), { ok: false, reason: "last_owner" });
  // Promoting a second owner lifts the guard.
  assert.deepEqual(changeMemberRole("usr-seed-jan", "workspace", "owner"), { ok: true });
  assert.deepEqual(changeMemberRole("usr-seed-petra", "workspace", "admin"), { ok: true });
});

test("setMemberPermissions grants a per-user capability (a recruiter becomes a Writer)", () => {
  assert.deepEqual(setMemberPermissions("usr-seed-marketa", "workspace", { grant: ["members:manage"], revoke: [] }), { ok: true });
  const marketa = listOrgMembers().find((m) => m.user.email === "marketa.svobodova@csas.cz")!;
  assert.ok(marketa.teams[0].capabilities.includes("members:manage"));
  assert.deepEqual(setMemberPermissions("usr-seed-marketa", "team-nope", { grant: ["read"], revoke: [] }), { ok: false, reason: "not_member" });
});

// HIGH (2026-07-09 scan, organizations-members-invites #2): acceptInvite unconditionally
// called setUserPassword on an existing account. Inviting an ACTIVE member is refused at
// POST /api/org/invites, but an invite minted BEFORE the account went active stays pending
// and redeemable — so whoever held that link could reset the member's password and take the
// account over. Redeem is provisioning only.
test("a stale invite cannot reset an ACTIVE member's password", () => {
  const first = inviteMember({ email: "stale.target@csas.cz", role: "recruiter" });
  assert.equal(acceptInvite({ token: first.token, name: "Stale Target", password: "original-pw-123" }).ok, true);
  assert.ok(verifyCredentials("stale.target@csas.cz", "original-pw-123"));

  // A second, still-pending invite for the same address.
  const stale = inviteMember({ email: "stale.target@csas.cz", role: "viewer" });
  assert.deepEqual(acceptInvite({ token: stale.token, name: "Attacker", password: "attacker-pw-999" }), {
    ok: false,
    reason: "already_active",
  });

  // The account is untouched: password, name, and role all survive.
  assert.ok(verifyCredentials("stale.target@csas.cz", "original-pw-123"), "original password still works");
  assert.equal(verifyCredentials("stale.target@csas.cz", "attacker-pw-999"), null, "attacker password rejected");
  const member = listOrgMembers().find((m) => m.user.email === "stale.target@csas.cz")!;
  assert.equal(member.user.name, "Stale Target");
  assert.equal(member.teams[0].role, "recruiter", "role not downgraded by the stale invite");
});

// MEDIUM (2026-07-09 scan, organizations-members-invites #3): the invite route signed
// the session from listMembershipsForUser(...)[0] — the OLDEST membership. A re-invited
// member (already on an older team) landed on that OLD team with the OLD role instead of
// the team/role the invite just granted. acceptInvite now RETURNS the accepted
// workspaceId + role so the route signs the correct claims.
test("accept returns the invite's team/role, not the member's oldest membership", () => {
  // David is seeded disabled with an existing membership on the default team as viewer
  // (the OLDEST membership). Re-invite him to a NEW team as admin.
  assert.equal(getUserByEmail("david.benes@csas.cz")!.status, "disabled");
  const teamB = createWorkspace("Team B");
  const invite = inviteMember({ email: "david.benes@csas.cz", role: "admin", workspaceId: teamB.id });

  const result = acceptInvite({ token: invite.token, password: "david-pw-123" });
  assert.ok(result.ok);
  // The session must be signed for the ACCEPTED team/role…
  assert.equal(result.workspaceId, teamB.id);
  assert.equal(result.role, "admin");
  // …even though the older default-team viewer membership still exists (what [0] returned).
  const teams = listOrgMembers().find((m) => m.user.email === "david.benes@csas.cz")!.teams;
  assert.ok(teams.some((t) => t.workspaceId === "workspace" && t.role === "viewer"), "old membership still present");
});
