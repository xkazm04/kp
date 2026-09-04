import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { DEFAULT_ORG_ID } from "./organizations.ts";
import {
  createUser,
  getUserByEmail,
  verifyCredentials,
  setUserPassword,
  hasPassword,
  setUserStatus,
  listUsersByOrg,
} from "./users.ts";

after(() => cleanupUnitDb());

test("create a user with a password, normalize email, and authenticate", () => {
  const u = createUser({ orgId: DEFAULT_ORG_ID, email: "Recruiter@CSAS.cz", name: "Recruiter One", password: "hunter2!" });
  assert.equal(u.email, "recruiter@csas.cz");
  assert.ok(hasPassword(u.id));
  assert.equal(getUserByEmail("RECRUITER@csas.cz")?.id, u.id);
  assert.equal(verifyCredentials("recruiter@csas.cz", "hunter2!")?.id, u.id);
  assert.equal(verifyCredentials("recruiter@csas.cz", "wrong"), null);
});

test("email is globally unique (case-insensitive)", () => {
  createUser({ orgId: DEFAULT_ORG_ID, email: "dup@csas.cz" });
  assert.throws(() => createUser({ orgId: DEFAULT_ORG_ID, email: "DUP@csas.cz" }), /UNIQUE/i);
});

test("a disabled user cannot authenticate even with the right password", () => {
  // "pw" until 2026-09-03; setUserPassword now enforces MIN_PASSWORD_LENGTH, so the
  // fixture uses a password a real account could actually have.
  const u = createUser({ orgId: DEFAULT_ORG_ID, email: "leaver@csas.cz", password: "leaver-pw-1" });
  assert.ok(verifyCredentials("leaver@csas.cz", "leaver-pw-1"));
  setUserStatus(u.id, "disabled");
  assert.equal(verifyCredentials("leaver@csas.cz", "leaver-pw-1"), null);
});

test("an invited user with no password cannot authenticate until one is set", () => {
  const u = createUser({ orgId: DEFAULT_ORG_ID, email: "invited@csas.cz", status: "invited" });
  assert.equal(hasPassword(u.id), false);
  assert.equal(verifyCredentials("invited@csas.cz", "anything"), null);
  setUserPassword(u.id, "chosen-pw");
  assert.equal(verifyCredentials("invited@csas.cz", "chosen-pw")?.id, u.id);
});

test("listUsersByOrg scopes to the org", () => {
  const before = listUsersByOrg(DEFAULT_ORG_ID).length;
  createUser({ orgId: DEFAULT_ORG_ID, email: `scoped${before}@csas.cz` });
  createUser({ orgId: "org-other", email: "other@acme.cz" });
  const rows = listUsersByOrg(DEFAULT_ORG_ID);
  assert.equal(rows.length, before + 1);
  assert.ok(!rows.some((u) => u.email === "other@acme.cz"));
});
