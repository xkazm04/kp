import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { DEFAULT_ORG_ID } from "./db/organizations.ts";
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
