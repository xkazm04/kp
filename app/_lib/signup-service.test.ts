import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { registerAccount, defaultOrgName } from "./signup-service.ts";
import { ensureDb } from "./db/core.ts";
import { getOrganization, listOrganizations } from "./db/organizations.ts";
import { getWorkspace, listWorkspacesByOrg } from "./db/workspaces.ts";
import { getMembership, listMembershipsForUser } from "./db/memberships.ts";
import { verifyCredentials } from "./db/users.ts";

after(() => cleanupUnitDb());

test("registration provisions org + team + owner in the switcher/console shape", () => {
  const r = registerAccount({ email: "Founder@Startup.io", password: "hunter2!!", name: "Founder One", orgName: "Startup s.r.o." });
  assert.ok(r.ok, "registration should succeed");
  if (!r.ok) return;

  // User: active, normalized email, credential verifies (the login route's check).
  assert.equal(r.user.email, "founder@startup.io");
  assert.equal(r.user.status, "active");
  assert.equal(verifyCredentials("FOUNDER@startup.io", "hunter2!!")?.id, r.user.id);

  // Org: real row, named from the form.
  assert.equal(getOrganization(r.orgId)?.name, "Startup s.r.o.");

  // Team: linked to the org with type='team' — the exact shape listWorkspacesByOrg
  // (the switcher/members console read) enumerates.
  const ws = getWorkspace(r.workspaceId);
  assert.equal(ws?.orgId, r.orgId);
  assert.equal(ws?.type, "team");
  assert.ok(listWorkspacesByOrg(r.orgId).some((w) => w.id === r.workspaceId));

  // Membership: owner on the new team, and the login route's "first team" read
  // (listMembershipsForUser[0]) resolves to it.
  assert.equal(getMembership(r.user.id, r.workspaceId)?.role, "owner");
  assert.equal(listMembershipsForUser(r.user.id)[0]?.workspaceId, r.workspaceId);
  assert.equal(r.role, "owner");
});

test("two signups land in two distinct orgs (never share a tenant)", () => {
  const a = registerAccount({ email: "a@one.example", password: "password-a" });
  const b = registerAccount({ email: "b@two.example", password: "password-b" });
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.notEqual(a.orgId, b.orgId);
  assert.notEqual(a.workspaceId, b.workspaceId);
  assert.equal(a.user.orgId, a.orgId);
  assert.equal(b.user.orgId, b.orgId);
});

test("duplicate email is refused (case-insensitive) and leaves NO orphan org/workspace", () => {
  const first = registerAccount({ email: "dup@corp.example", password: "password-1" });
  assert.ok(first.ok);
  const orgsBefore = listOrganizations().length;
  const wsBefore = (ensureDb().prepare(`SELECT COUNT(*) AS n FROM workspaces`).get() as { n: number }).n;

  const second = registerAccount({ email: "DUP@corp.example", password: "password-2", orgName: "Sneaky Second" });
  assert.deepEqual(second, { ok: false, reason: "email_taken" });

  // The transaction rolled everything back — no half-created tenant.
  assert.equal(listOrganizations().length, orgsBefore);
  assert.equal((ensureDb().prepare(`SELECT COUNT(*) AS n FROM workspaces`).get() as { n: number }).n, wsBefore);
  assert.ok(!listOrganizations().some((o) => o.name === "Sneaky Second"));
});

test("validation: email shape and the MIN_PASSWORD_LENGTH floor", () => {
  assert.deepEqual(registerAccount({ email: "not-an-email", password: "long-enough-pw" }), { ok: false, reason: "invalid_email" });
  assert.deepEqual(registerAccount({ email: "has @spaces.example", password: "long-enough-pw" }), { ok: false, reason: "invalid_email" });
  assert.deepEqual(registerAccount({ email: "ok@corp.example", password: "short" }), { ok: false, reason: "weak_password" });
  // Nothing was created by the refused attempts.
  assert.equal(verifyCredentials("ok@corp.example", "short"), null);
});

test("blank org name falls back to the email domain, never the Untitled placeholder", () => {
  assert.equal(defaultOrgName("someone@acme.io"), "acme.io");
  const r = registerAccount({ email: "someone@acme.io", password: "password-3", orgName: "   " });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(getOrganization(r.orgId)?.name, "acme.io");
});
