import { test } from "node:test";
import assert from "node:assert/strict";
import { ORG_ADMIN_CAPABILITIES, orgAdminCapabilities, workspaceCapabilities } from "./org-authority.ts";
import { roleCapabilities, type Capability } from "./roles.ts";

// The authority split the Workspaces console runs on: administrative capability is
// ORG-WIDE, operational capability stays PER WORKSPACE. Getting this backwards in
// either direction is a real bug — leak operational caps and one team reads
// another's candidates; scope admin caps per team and "an admin can adjust any
// workspace" becomes unimplementable.

test("an owner of ONE team holds every admin capability across the org", () => {
  const caps = orgAdminCapabilities([{ role: "owner", overrides: null }]);
  for (const cap of ORG_ADMIN_CAPABILITIES) assert.equal(caps.has(cap), true, `expected org-wide ${cap}`);
});

test("operational capabilities are never conferred org-wide", () => {
  // An owner holds read + pipeline:write on their OWN team, but neither may travel.
  const caps = orgAdminCapabilities([{ role: "owner", overrides: null }]);
  assert.equal(caps.has("read"), false, "read must stay per-workspace");
  assert.equal(caps.has("pipeline:write"), false, "pipeline:write must stay per-workspace");
});

test("a recruiter confers nothing org-wide", () => {
  assert.equal(orgAdminCapabilities([{ role: "recruiter", overrides: null }]).size, 0);
  assert.equal(orgAdminCapabilities([{ role: "viewer", overrides: null }]).size, 0);
  assert.equal(orgAdminCapabilities([{ role: "hiring_manager", overrides: null }]).size, 0);
});

test("no memberships means no authority (fail closed)", () => {
  assert.equal(orgAdminCapabilities([]).size, 0);
});

test("the union spans memberships: admin on team B lifts a viewer on team A", () => {
  const caps = orgAdminCapabilities([
    { role: "viewer", overrides: null },
    { role: "admin", overrides: null },
  ]);
  assert.equal(caps.has("members:manage"), true);
  assert.equal(caps.has("team:manage"), true);
  // admin does not carry org:manage, and the union cannot invent it.
  assert.equal(caps.has("org:manage"), false);
});

test("a per-user GRANT of members:manage travels org-wide; a REVOKE removes it", () => {
  const granted = orgAdminCapabilities([{ role: "recruiter", overrides: { grant: ["members:manage"], revoke: [] } }]);
  assert.equal(granted.has("members:manage"), true, "a delegated Writer administers the org's teams");

  const revoked = orgAdminCapabilities([{ role: "admin", overrides: { grant: [], revoke: ["members:manage"] } }]);
  assert.equal(revoked.has("members:manage"), false, "a revoke on the only membership removes the org-wide grant");
  assert.equal(revoked.has("team:manage"), true, "the untouched admin capability survives");
});

test("workspaceCapabilities merges the local seat with org-wide admin", () => {
  // A viewer on THIS team who is an admin on another: reads here, and may
  // administer seats here, but gains no pipeline:write from the admin role
  // elsewhere.
  const local = roleCapabilities("viewer");
  const caps = workspaceCapabilities(local, [{ role: "viewer", overrides: null }, { role: "admin", overrides: null }]);
  assert.equal(caps.has("read"), true, "the local seat still grants read");
  assert.equal(caps.has("members:manage"), true, "org-wide admin reaches this team");
  assert.equal(caps.has("pipeline:write"), false, "admin elsewhere does not grant write here");
});

test("workspaceCapabilities on a team you do not belong to grants admin only", () => {
  const none: ReadonlySet<Capability> = new Set();
  const caps = workspaceCapabilities(none, [{ role: "owner", overrides: null }]);
  assert.equal(caps.has("members:manage"), true, "an owner administers every team in the org");
  assert.equal(caps.has("read"), false, "…but administering is not reading; no seat, no data");
  assert.equal(caps.has("pipeline:write"), false);
});
