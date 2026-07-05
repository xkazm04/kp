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
