// The per-user half of the authorization layer — "what can THIS person do on THIS
// team?" — and, like require-operator.ts, a file with no test until now despite
// deciding every capability gate in the app. The clauses that matter are the ones a
// reader would not guess:
//
//   * open mode AND a password-mode operator session both fold to OWNER;
//   * a claim-less session is AUTHENTICATED WITH NOTHING (403, not owner) — it used
//     to be inferred as the operator, which made /api/auth/switch-workspace a
//     privilege-escalation path;
//   * capabilities resolve LIVE from the DB (role + per-user overrides), so a
//     permission change lands on the next request without a re-login;
//   * a workspace in ANOTHER org answers 404, never 403 — a cross-org probe must
//     not learn that the id exists.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { cleanupUnitDb } from "../testing/unit-db.ts";

const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
const NEXT_SERVER_SHIM = new URL("../testing/next-server-shim.mjs", import.meta.url).href;
let cookieValue: string | null = null;
(globalThis as { __kpCurrentUserCookie?: () => string | null }).__kpCurrentUserCookie = () => cookieValue;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    if (specifier === "next/server") return { url: NEXT_SERVER_SHIM, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() {
            const value = globalThis.__kpCurrentUserCookie();
            return {
              get: (name) => (name === ${JSON.stringify(SESSION_COOKIE)} && value ? { name, value } : undefined),
              set: () => {},
            };
          }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

process.env.KP_SECRET = "current-user-test-secret";
process.env.KP_OPERATOR_PASSWORD = "current-user-test-password";

const {
  can,
  callerCapabilities,
  callerOrgCapabilities,
  callerWorkspaceCapabilities,
  currentSession,
  currentUser,
  requireCapability,
  requireOrgCapability,
  requireWorkspaceCapability,
} = await import("./current-user.ts");
const { signSession, DEMO_WORKSPACE } = await import("./session.ts");
const { createWorkspace } = await import("../db/workspaces.ts");
const { createUser, setUserStatus } = await import("../db/users.ts");
const { upsertMembership, setMembershipOverrides } = await import("../db/memberships.ts");

after(() => cleanupUnitDb());

const ORG = "org-default";
const OTHER_ORG = "org-competitor";
const team = createWorkspace("Caps team", ORG);
const sisterTeam = createWorkspace("Caps sister team", ORG); // same org, no membership
const foreignTeam = createWorkspace("A competitor team", OTHER_ORG);

const owner = createUser({ orgId: ORG, email: "caps.owner@csas.cz", name: "Owner", status: "active", password: "owner-pw-1234" });
const admin = createUser({ orgId: ORG, email: "caps.admin@csas.cz", name: "Admin", status: "active", password: "admin-pw-1234" });
const recruiter = createUser({ orgId: ORG, email: "caps.rec@csas.cz", name: "Rec", status: "active", password: "rec-pw-12345" });
const viewer = createUser({ orgId: ORG, email: "caps.view@csas.cz", name: "View", status: "active", password: "view-pw-1234" });
const stranger = createUser({ orgId: ORG, email: "caps.none@csas.cz", name: "None", status: "active", password: "none-pw-1234" });
const suspended = createUser({ orgId: ORG, email: "caps.off@csas.cz", name: "Off", status: "active", password: "off-pw-12345" });
upsertMembership(owner.id, team.id, "owner");
upsertMembership(admin.id, team.id, "admin");
upsertMembership(recruiter.id, team.id, "recruiter");
upsertMembership(viewer.id, team.id, "viewer");
upsertMembership(suspended.id, team.id, "recruiter");
setUserStatus(suspended.id, "disabled");

function signedInAs(user: { id: string; orgId: string } | null, workspace: string = team.id): void {
  cookieValue = user === null ? null : signSession(workspace, Date.now(), { sub: user.id, org: user.orgId });
}
function asOperator(): void {
  cookieValue = signSession(team.id, Date.now(), { op: true });
}

// ---- open mode --------------------------------------------------------------

test("OPEN MODE folds every caller to owner — local dev is unchanged by the gate", async () => {
  delete process.env.KP_OPERATOR_PASSWORD;
  cookieValue = null;
  try {
    assert.equal(await can("org:manage"), true);
    assert.deepEqual([...(await callerCapabilities())].sort(), ["members:manage", "org:manage", "pipeline:write", "read", "team:manage"]);
    assert.equal(await requireCapability("org:manage"), null);
    assert.equal(await requireWorkspaceCapability(foreignTeam.id, "org:manage"), null, "no tenants to separate in open dev");
    assert.equal(await requireOrgCapability("members:manage"), null);
  } finally {
    process.env.KP_OPERATOR_PASSWORD = "current-user-test-password";
  }
});

// ---- authentication ---------------------------------------------------------

test("no session: 401, and nothing resolves", async () => {
  signedInAs(null);
  assert.equal(await currentSession(), null);
  assert.equal(await can("read"), false);
  assert.deepEqual(await callerCapabilities(), []);
  assert.equal((await requireCapability("read"))?.status, 401);
  assert.equal((await requireOrgCapability("members:manage"))?.status, 401);
  assert.equal((await requireWorkspaceCapability(team.id, "read"))?.status, 401);
  const { userId, orgId, role, capabilities } = await currentUser();
  assert.deepEqual({ userId, orgId, role, capabilities }, { userId: null, orgId: null, role: null, capabilities: [] });
});

test("an anonymous DEMO session is treated as unauthenticated (401), never as a member", async () => {
  cookieValue = signSession(DEMO_WORKSPACE, Date.now(), {});
  assert.equal(await can("read"), false);
  assert.equal((await requireCapability("read"))?.status, 401);
});

test("REGRESSION: a claim-less non-operator session is authenticated with NOTHING (403)", async () => {
  // resolveCaller once inferred "operator" from a missing `sub`, so any claim-less
  // cookie carried owner. switch-workspace re-minted exactly such a cookie, which
  // made "switch to the default team and back" a promotion to owner.
  cookieValue = signSession(team.id, Date.now(), {});
  assert.equal(await can("org:manage"), false);
  assert.equal((await requireCapability("read"))?.status, 403, "403 = we know who you are and it is not enough");
});

test("an operator session is owner everywhere in the app", async () => {
  asOperator();
  assert.equal(await can("org:manage"), true);
  assert.equal(await requireCapability("org:manage"), null);
  assert.equal(await requireWorkspaceCapability(team.id, "org:manage"), null);
  assert.equal(await requireOrgCapability("members:manage"), null);
  // …but it carries no IDENTITY, which is a different question from authority.
  const me = await currentUser();
  assert.equal(me.userId, null);
  assert.deepEqual(me.capabilities, [], "currentUser() is session-identity-only by contract");
});

// ---- the role matrix, resolved live -----------------------------------------

test("the role matrix decides what a member may do on their own team", async () => {
  signedInAs(owner);
  assert.equal(await can("org:manage"), true);

  signedInAs(admin);
  assert.equal(await can("members:manage"), true);
  assert.equal(await can("org:manage"), false, "org settings are the owner's alone");
  assert.equal((await requireCapability("org:manage"))?.status, 403);

  signedInAs(recruiter);
  assert.equal(await can("pipeline:write"), true);
  assert.equal(await can("members:manage"), false);
  assert.equal((await requireCapability("members:manage"))?.status, 403);

  signedInAs(viewer);
  assert.equal(await can("read"), true);
  assert.equal(await can("pipeline:write"), false);
});

test("a member of the ORG but not of THIS team is authenticated with no capabilities (403)", async () => {
  signedInAs(stranger);
  assert.equal(await can("read"), false);
  assert.equal((await requireCapability("read"))?.status, 403);
});

test("a DISABLED user keeps a valid cookie and loses every capability", async () => {
  signedInAs(suspended);
  assert.equal(await can("read"), false);
  assert.equal((await requireCapability("pipeline:write"))?.status, 403);
});

test("per-user overrides resolve LIVE — a permission change lands without a re-login", async () => {
  signedInAs(recruiter);
  assert.equal(await can("members:manage"), false);
  // Promote the seat to a "Writer" who may invite…
  setMembershipOverrides(recruiter.id, team.id, { grant: ["members:manage"], revoke: [] });
  assert.equal(await can("members:manage"), true, "the SAME cookie now resolves the new grant");
  assert.equal(await requireCapability("members:manage"), null);
  // …and revoking makes the same seat read-only, again with no new session.
  setMembershipOverrides(recruiter.id, team.id, { grant: [], revoke: ["pipeline:write"] });
  assert.equal(await can("pipeline:write"), false);
  assert.equal(await can("read"), true);
  const me = await currentUser();
  assert.equal(me.role, "recruiter", "the ROLE is unchanged — the override is the difference");
  assert.equal(me.capabilities.includes("pipeline:write"), false);
  setMembershipOverrides(recruiter.id, team.id, null);
  assert.equal(await can("pipeline:write"), true);
});

test("currentUser() reports identity + the live role for the UI", async () => {
  signedInAs(admin);
  const me = await currentUser();
  assert.equal(me.userId, admin.id);
  assert.equal(me.orgId, ORG);
  assert.equal(me.role, "admin");
  assert.deepEqual([...me.capabilities].sort(), ["members:manage", "pipeline:write", "read", "team:manage"]);
});

// ---- cross-workspace authority (requireWorkspaceCapability) -----------------

test("an ADMIN reaches a sister team's SEATS, but not its candidate data", async () => {
  signedInAs(admin);
  // Administering seats is a company-level job…
  assert.equal(await requireWorkspaceCapability(sisterTeam.id, "members:manage"), null);
  // …while team data stays team-private: no membership there, no read.
  assert.equal((await requireWorkspaceCapability(sisterTeam.id, "read"))?.status, 403);
  assert.equal((await callerWorkspaceCapabilities(sisterTeam.id)).has("pipeline:write"), false);
});

test("a recruiter has no authority on a sister team at all (403)", async () => {
  signedInAs(recruiter);
  assert.equal((await requireWorkspaceCapability(sisterTeam.id, "members:manage"))?.status, 403);
  assert.deepEqual([...(await callerWorkspaceCapabilities(sisterTeam.id))], []);
});

test("CRITICAL: another org's workspace answers 404, never 403 — an id must not be confirmable", async () => {
  signedInAs(owner);
  const denied = await requireWorkspaceCapability(foreignTeam.id, "read");
  assert.equal(denied?.status, 404);
  assert.deepEqual(await denied?.json(), { error: "Not found" });
  assert.deepEqual([...(await callerWorkspaceCapabilities(foreignTeam.id))], [], "not even for an owner");
});

test("org-wide authority is the admin capabilities the caller holds ANYWHERE in their org", async () => {
  signedInAs(owner);
  assert.equal((await callerOrgCapabilities()).has("org:manage"), true);
  assert.equal(await requireOrgCapability("team:manage"), null);

  signedInAs(recruiter);
  assert.equal((await callerOrgCapabilities()).has("team:manage"), false);
  assert.equal((await requireOrgCapability("team:manage"))?.status, 403);
});

test("a session whose org claim is missing has no cross-workspace authority", async () => {
  // Fails closed: without an org there is no tenant boundary to check against.
  cookieValue = signSession(team.id, Date.now(), { sub: owner.id });
  assert.deepEqual([...(await callerWorkspaceCapabilities(team.id))], []);
  assert.deepEqual([...(await callerOrgCapabilities())], []);
});
