import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_WORKSPACE_ADMIN,
  foldWorkspaceAdminLoad,
  type MembersResponse,
  type OrgMemberDto,
  type WorkspaceAdminSnapshot,
  type WorkspacesResponse,
} from "@/app/features/settings/workspace/workspaceAdminLoad";

// The Workspaces console fires three requests in parallel and folds the answers
// into one snapshot. The interesting behaviour is what it does when only SOME of
// them arrive, and until this file that behaviour was expressed only as the order
// of eleven setState calls inside a promise chain — untestable, and quietly wrong
// in one place: a caller who MAY manage members but whose invites request failed
// got an empty pending-invite list rendered as fact.
//
// These pin the three rules the fold now states out loud.

const alice: OrgMemberDto = {
  user: { id: "u1", email: "alice@example.com", name: "Alice", status: "active", createdAt: "2026-01-01" },
  teams: [{ workspaceId: "sales", role: "owner", capabilities: ["read"] }],
};

const membersOk = (canManage: boolean): MembersResponse => ({
  members: [alice],
  canManage,
  callerCapabilities: canManage ? ["members:manage", "read"] : ["read"],
});

const workspacesOk: WorkspacesResponse = {
  workspaces: [{ id: "sales", name: "Sales", orgId: "org-default", type: null, createdAt: "2026-01-01", memberCount: 1, role: "owner", canManage: true }],
  current: "sales",
  defaultWorkspace: "sales",
  multiWorkspace: true,
  canManage: true,
};

const invite = {
  token: "tok-1",
  email: "new@example.com",
  role: "recruiter" as const,
  workspaceId: "sales",
  createdAt: "2026-01-01",
  expiresAt: null,
};

/** A console that has already loaded once — the state a RELOAD folds onto. */
const loaded: WorkspaceAdminSnapshot = foldWorkspaceAdminLoad(EMPTY_WORKSPACE_ADMIN, {
  members: membersOk(true),
  workspaces: workspacesOk,
  invites: [invite],
});

test("a complete arrival is simply the new reading", () => {
  assert.equal(loaded.error, false);
  assert.equal(loaded.partial, false);
  assert.deepEqual(
    loaded.workspaces.map((w) => w.id),
    ["sales"]
  );
  assert.equal(loaded.invites.length, 1);
  assert.equal(loaded.canManageMembers, true);
  assert.equal(loaded.current, "sales");
});

test("members ok + invites failed is PARTIAL, not an error — and keeps the invites it had", () => {
  // The failure this pins: the pending-invite section would otherwise render an
  // empty list as fact, so an administrator would believe outstanding invites had
  // been revoked.
  const next = foldWorkspaceAdminLoad(loaded, { members: membersOk(true), workspaces: workspacesOk, invites: null });
  assert.equal(next.error, false, "the roster arrived — the console works");
  assert.equal(next.partial, true, "…but it is not showing a complete reading, and says so");
  assert.deepEqual(next.invites, [invite], "the previous list survives rather than being blanked");
});

test("for a caller who may NOT manage members, a missing invites answer is the complete answer", () => {
  // They are refused there by design (403), so "no list" is not a failure and must
  // not raise a partial-load flag at them.
  const next = foldWorkspaceAdminLoad(loaded, { members: membersOk(false), workspaces: workspacesOk, invites: null });
  assert.equal(next.partial, false);
  assert.deepEqual(next.invites, [], "…and nothing gated is left on screen from the previous reading");
});

test("a missing teams answer keeps the previous list instead of claiming there are none", () => {
  const next = foldWorkspaceAdminLoad(loaded, { members: membersOk(true), workspaces: null, invites: [invite] });
  assert.equal(next.partial, true);
  assert.deepEqual(
    next.workspaces.map((w) => w.id),
    ["sales"],
    "the members it just loaded plainly sit on a team"
  );
  assert.equal(next.current, "sales");
  assert.equal(next.multiWorkspace, true);
});

test("a failed members request is the error state, and does not blank the roster", () => {
  const next = foldWorkspaceAdminLoad(loaded, { members: null, workspaces: workspacesOk, invites: [invite] });
  assert.equal(next.error, true);
  assert.equal(next.partial, false, "error subsumes partial — one line, not two");
  assert.deepEqual(next.members, [alice], "stale under an explicit error beats 'everybody is gone'");
});

test("the first load starts from nothing, so a total failure shows an empty errored console", () => {
  const next = foldWorkspaceAdminLoad(EMPTY_WORKSPACE_ADMIN, { members: null, workspaces: null, invites: null });
  assert.equal(next.error, true);
  assert.deepEqual(next.members, []);
  assert.deepEqual(next.workspaces, []);
});
