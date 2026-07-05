import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { DEFAULT_ORG_ID } from "./organizations.ts";
import { createInvite, getInvite, getRedeemableInvite, markInviteAccepted, revokeInvite, listInvitesForOrg } from "./invites.ts";

after(() => cleanupUnitDb());

test("create a pending invite that is redeemable", () => {
  const inv = createInvite({ orgId: DEFAULT_ORG_ID, email: "New@csas.cz", role: "recruiter", workspaceId: "workspace" });
  assert.equal(inv.status, "pending");
  assert.equal(inv.email, "new@csas.cz");
  assert.match(inv.token, /^inv-/);
  assert.ok(getRedeemableInvite(inv.token));
  assert.equal(getInvite(inv.token)?.role, "recruiter");
});

test("an expired invite is not redeemable", () => {
  const past = Date.parse("2020-01-01T00:00:00Z");
  const inv = createInvite({ orgId: DEFAULT_ORG_ID, email: "old@csas.cz", role: "viewer" }, past);
  assert.equal(getRedeemableInvite(inv.token, Date.parse("2020-02-01T00:00:00Z")), null);
});

test("accept is one-shot; revoke blocks a pending invite", () => {
  const a = createInvite({ orgId: DEFAULT_ORG_ID, email: "accept@csas.cz", role: "recruiter" });
  assert.equal(markInviteAccepted(a.token), true);
  assert.equal(markInviteAccepted(a.token), false, "double-accept is a no-op");
  assert.equal(getInvite(a.token)?.status, "accepted");
  assert.equal(getRedeemableInvite(a.token), null);

  const b = createInvite({ orgId: DEFAULT_ORG_ID, email: "revoke@csas.cz", role: "viewer" });
  assert.equal(revokeInvite(b.token), true);
  assert.equal(getRedeemableInvite(b.token), null);
  assert.equal(revokeInvite(b.token), false, "revoking a non-pending invite is a no-op");
});

test("listInvitesForOrg filters by status", () => {
  const pendingBefore = listInvitesForOrg(DEFAULT_ORG_ID, "pending").length;
  createInvite({ orgId: DEFAULT_ORG_ID, email: "list@csas.cz", role: "recruiter" });
  assert.equal(listInvitesForOrg(DEFAULT_ORG_ID, "pending").length, pendingBefore + 1);
});
