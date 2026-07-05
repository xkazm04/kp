import { test } from "node:test";
import assert from "node:assert/strict";
import { roleCan, roleAtLeast, isMemberRole, MEMBER_ROLES } from "./roles.ts";

test("owner has every capability; viewer only reads", () => {
  for (const cap of ["org:manage", "members:manage", "team:manage", "pipeline:write", "read"] as const) {
    assert.equal(roleCan("owner", cap), true, `owner should have ${cap}`);
  }
  assert.equal(roleCan("viewer", "read"), true);
  assert.equal(roleCan("viewer", "pipeline:write"), false);
  assert.equal(roleCan("viewer", "members:manage"), false);
});

test("only owner manages the org; admin manages members but not the org", () => {
  assert.equal(roleCan("owner", "org:manage"), true);
  assert.equal(roleCan("admin", "org:manage"), false);
  assert.equal(roleCan("admin", "members:manage"), true);
  assert.equal(roleCan("recruiter", "members:manage"), false);
});

test("recruiter and hiring_manager can write the pipeline; viewer cannot", () => {
  assert.equal(roleCan("recruiter", "pipeline:write"), true);
  assert.equal(roleCan("hiring_manager", "pipeline:write"), true);
  assert.equal(roleCan("viewer", "pipeline:write"), false);
});

test("roleAtLeast ranks roles and fails closed on null/unknown", () => {
  assert.equal(roleAtLeast("admin", "recruiter"), true);
  assert.equal(roleAtLeast("recruiter", "admin"), false);
  assert.equal(roleAtLeast("owner", "owner"), true);
  assert.equal(roleAtLeast(null, "viewer"), false);
  assert.equal(roleCan(null, "read"), false);
});

test("isMemberRole guards the enum", () => {
  for (const r of MEMBER_ROLES) assert.equal(isMemberRole(r), true);
  assert.equal(isMemberRole("superuser"), false);
  assert.equal(isMemberRole(null), false);
});
