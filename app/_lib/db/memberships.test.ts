import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { DEFAULT_ORG_ID } from "./organizations.ts";
import { createUser } from "./users.ts";
import {
  upsertMembership,
  getMembership,
  listMembershipsForUser,
  listMembershipsForWorkspace,
  removeMembership,
  roleForUserInWorkspace,
  setMembershipOverrides,
  capabilitiesForUserInWorkspace,
} from "./memberships.ts";

after(() => cleanupUnitDb());

test("upsert is idempotent per (user, team) and updates the role in place", () => {
  const u = createUser({ orgId: DEFAULT_ORG_ID, email: "m1@csas.cz" });
  const m1 = upsertMembership(u.id, "workspace", "recruiter");
  assert.equal(m1.role, "recruiter");
  const m2 = upsertMembership(u.id, "workspace", "admin");
  assert.equal(m2.role, "admin");
  assert.equal(m2.id, m1.id, "same membership row survives the role change");
  assert.equal(listMembershipsForUser(u.id).length, 1);
  assert.equal(roleForUserInWorkspace(u.id, "workspace"), "admin");
});

test("a user can belong to several teams of the same org", () => {
  const u = createUser({ orgId: DEFAULT_ORG_ID, email: "m2@csas.cz" });
  upsertMembership(u.id, "team-a", "recruiter");
  upsertMembership(u.id, "team-b", "viewer");
  const teams = listMembershipsForUser(u.id)
    .map((m) => m.workspaceId)
    .sort();
  assert.deepEqual(teams, ["team-a", "team-b"]);
});

test("per-user capability overrides persist, resolve live, and survive a role change", () => {
  const u = createUser({ orgId: DEFAULT_ORG_ID, email: "override@csas.cz" });
  upsertMembership(u.id, "workspace", "recruiter");
  // Recruiter default: pipeline:write + read, but NOT members:manage.
  assert.equal(capabilitiesForUserInWorkspace(u.id, "workspace").has("members:manage"), false);

  // Grant members:manage → a "Writer" who can invite.
  assert.equal(setMembershipOverrides(u.id, "workspace", { grant: ["members:manage"], revoke: [] }), true);
  let caps = capabilitiesForUserInWorkspace(u.id, "workspace");
  assert.equal(caps.has("members:manage"), true);
  assert.equal(caps.has("pipeline:write"), true);
  assert.deepEqual(getMembership(u.id, "workspace")!.overrides, { grant: ["members:manage"], revoke: [] });

  // A role change preserves the override (upsert only touches role).
  upsertMembership(u.id, "workspace", "viewer");
  caps = capabilitiesForUserInWorkspace(u.id, "workspace");
  assert.equal(caps.has("members:manage"), true, "override survived the role change");
  assert.equal(caps.has("read"), true);

  // Clearing the override drops back to pure role defaults.
  assert.equal(setMembershipOverrides(u.id, "workspace", null), true);
  assert.equal(capabilitiesForUserInWorkspace(u.id, "workspace").has("members:manage"), false);
});

test("org:manage cannot be granted to a non-owner via an override", () => {
  const u = createUser({ orgId: DEFAULT_ORG_ID, email: "escalate@csas.cz" });
  upsertMembership(u.id, "workspace", "admin");
  setMembershipOverrides(u.id, "workspace", { grant: ["org:manage"], revoke: [] });
  assert.equal(capabilitiesForUserInWorkspace(u.id, "workspace").has("org:manage"), false);
  // The org:manage-only grant sanitizes to null, so no override row survives.
  assert.equal(getMembership(u.id, "workspace")!.overrides, null);
});

test("list a team's members, then remove one", () => {
  const a = createUser({ orgId: DEFAULT_ORG_ID, email: "m3a@csas.cz" });
  const b = createUser({ orgId: DEFAULT_ORG_ID, email: "m3b@csas.cz" });
  upsertMembership(a.id, "team-x", "recruiter");
  upsertMembership(b.id, "team-x", "viewer");
  assert.equal(listMembershipsForWorkspace("team-x").length, 2);
  assert.equal(removeMembership(a.id, "team-x"), true);
  assert.equal(listMembershipsForWorkspace("team-x").length, 1);
  assert.equal(roleForUserInWorkspace(a.id, "team-x"), null);
  assert.equal(getMembership(a.id, "team-x"), null);
});
