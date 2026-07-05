import { test } from "node:test";
import assert from "node:assert/strict";
import { roleCan, roleAtLeast, isMemberRole, MEMBER_ROLES, resolveCapabilities, sanitizeOverride, capable } from "./roles.ts";

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

test("per-user overrides grant and revoke on top of the role", () => {
  // A recruiter granted members:manage becomes a "Writer" who can invite.
  const promoted = resolveCapabilities("recruiter", { grant: ["members:manage"], revoke: [] });
  assert.equal(promoted.has("members:manage"), true);
  assert.equal(promoted.has("pipeline:write"), true, "role default is kept");
  // A revoke removes a role default (read-only seat).
  const readonly = resolveCapabilities("recruiter", { grant: [], revoke: ["pipeline:write"] });
  assert.equal(readonly.has("pipeline:write"), false);
  assert.equal(readonly.has("read"), true);
});

test("org:manage is never grantable via an override (owner-role only)", () => {
  assert.equal(resolveCapabilities("admin", { grant: ["org:manage"], revoke: [] }).has("org:manage"), false);
  assert.equal(capable("owner", null, "org:manage"), true, "still granted by the owner role itself");
});

test("sanitizeOverride drops unknowns, de-dupes, lets revoke win, and strips org:manage grants", () => {
  assert.equal(sanitizeOverride({ grant: ["bogus"], revoke: [] }), null);
  assert.deepEqual(sanitizeOverride({ grant: ["members:manage", "members:manage"], revoke: [] }), {
    grant: ["members:manage"],
    revoke: [],
  });
  assert.deepEqual(sanitizeOverride({ grant: ["pipeline:write"], revoke: ["pipeline:write"] }), {
    grant: [],
    revoke: ["pipeline:write"],
  });
  assert.equal(sanitizeOverride({ grant: ["org:manage"], revoke: [] }), null, "an org:manage-only grant sanitizes to null");
});
