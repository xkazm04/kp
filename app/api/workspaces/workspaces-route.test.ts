// The workspace routes decide who may SEE, CREATE, RENAME and JOIN a team — the
// four questions the Workspaces console asks. Every one of them was open:
//
//   GET  /api/workspaces        had no capability gate and returned listWorkspaces()
//                               — every workspace row in the DATABASE, across orgs.
//   POST /api/workspaces        had no capability gate, stamped DEFAULT_ORG_ID
//                               regardless of the caller, and seated nobody, so the
//                               new team was an orphan.
//   PUT/DELETE .../members/:id  did not exist; a second seat was unreachable.
//   POST /api/auth/switch-workspace  verified only that the workspace EXISTED, then
//                               minted a session for it.
//
// This file drives the REAL handlers on a throwaway SQLite file.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

// Point next/server at the shared test shim BEFORE the routes load (hooks only affect
// later resolutions — hence the dynamic imports below).
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope, so `cookies()` throws and the
// auth helpers degrade. These tests are ABOUT that decision, so resolve `next/headers`
// to a virtual module whose jar this file drives.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpWsTestCookie?: () => string | null }).__kpWsTestCookie = () => cookieValue;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: VIRTUAL_HEADERS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === VIRTUAL_HEADERS) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export async function cookies() {
            const value = globalThis.__kpWsTestCookie();
            return { get: (name) => (name === ${JSON.stringify(SESSION_COOKIE)} && value ? { name, value } : undefined) };
          }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

// A signing secret AND an operator password: without the password every caller folds
// to owner (open dev mode) and there is no authority decision left to prove.
process.env.KP_SECRET = "workspaces-route-test-secret";
process.env.KP_OPERATOR_PASSWORD = "workspaces-route-test-password";
// The routes under test gate CREATE/RENAME/SWITCH behind the deployment lock.
process.env.KP_MULTI_WORKSPACE = "1";

const { GET: listWorkspacesRoute, POST: createWorkspaceRoute } = await import("./route.ts");
const { PATCH: renameRoute } = await import("./[id]/route.ts");
const { PUT: seatRoute, DELETE: unseatRoute } = await import("./[id]/members/[userId]/route.ts");
const { POST: switchRoute } = await import("../auth/switch-workspace/route.ts");
const { createWorkspace, getWorkspace } = await import("../../_lib/db/workspaces.ts");
const { createUser } = await import("../../_lib/db/users.ts");
const { upsertMembership, getMembership } = await import("../../_lib/db/memberships.ts");
const { signSession, DEFAULT_WORKSPACE } = await import("../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-default"; // the seeded org the default workspace belongs to
const OTHER_ORG = "org-rival";

// Three people in the seeded org: an admin (org-wide members:manage + team:manage),
// a plain recruiter, and a lone owner on a team nobody else touches.
const admin = createUser({ orgId: ORG, email: "ws.admin@csas.cz", name: "WS Admin", status: "active", password: "admin-pw-1234" });
const plain = createUser({ orgId: ORG, email: "ws.plain@csas.cz", name: "WS Plain", status: "active", password: "plain-pw-1234" });
// …and a stranger in a DIFFERENT org, to prove the org boundary.
const rival = createUser({ orgId: OTHER_ORG, email: "ws.rival@rival.test", name: "WS Rival", status: "active", password: "rival-pw-1234" });

const teamA = createWorkspace("Team A", ORG);
const teamB = createWorkspace("Team B", ORG);
const rivalTeam = createWorkspace("Rival team", OTHER_ORG);

upsertMembership(admin.id, teamA.id, "admin");
upsertMembership(plain.id, teamA.id, "recruiter");
upsertMembership(rival.id, rivalTeam.id, "owner");

/** Sign in as a real user (null ⇒ no session cookie at all). */
function signedInAs(user: { id: string; orgId: string } | null, workspace = teamA.id): void {
  cookieValue = user === null ? null : signSession(workspace, Date.now(), { sub: user.id, org: user.orgId });
}

const req = (body?: unknown): NextRequest =>
  new Request("http://localhost/api/workspaces", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;

const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

before(() => signedInAs(admin));

// ---- GET: org-filtered, membership-filtered ------------------------------------

test("GET lists the caller's ORG only — never another org's teams", async () => {
  signedInAs(admin);
  const body = (await (await listWorkspacesRoute()).json()) as { workspaces: { id: string }[]; canManage: boolean };
  const ids = body.workspaces.map((w) => w.id);
  assert.ok(ids.includes(teamA.id) && ids.includes(teamB.id), "an org admin sees every team in their org");
  assert.ok(!ids.includes(rivalTeam.id), "another org's team must never appear");
  assert.equal(body.canManage, true);
});

test("GET shows a plain member only the teams they sit on", async () => {
  signedInAs(plain);
  const body = (await (await listWorkspacesRoute()).json()) as { workspaces: { id: string; role: string | null }[]; canManage: boolean };
  const ids = body.workspaces.map((w) => w.id);
  assert.deepEqual(ids, [teamA.id], "a recruiter administers nothing, so they see only their own seat");
  assert.equal(body.workspaces[0].role, "recruiter", "the row carries the caller's own role");
  assert.equal(body.canManage, false);
});

test("GET refuses a caller with no session", async () => {
  signedInAs(null);
  assert.equal((await listWorkspacesRoute()).status, 401);
});

// ---- POST: gated, org-stamped, creator seated ----------------------------------

test("POST refuses a caller without team:manage", async () => {
  signedInAs(plain);
  const r = await createWorkspaceRoute(req({ name: "Recruiter's team" }));
  assert.equal(r.status, 403, "a recruiter may not mint a tenant");
});

test("POST stamps the CALLER's org and seats them as owner", async () => {
  signedInAs(admin);
  const r = await createWorkspaceRoute(req({ name: "Team C" }));
  assert.equal(r.status, 200);
  const { workspace } = (await r.json()) as { workspace: { id: string; orgId: string; name: string } };
  assert.equal(workspace.orgId, ORG, "the caller's org, not DEFAULT_ORG_ID");
  assert.equal(getMembership(admin.id, workspace.id)?.role, "owner", "the creator is seated, so the team is never an orphan");
});

test("POST rejects an empty name", async () => {
  signedInAs(admin);
  assert.equal((await createWorkspaceRoute(req({ name: "   " }))).status, 400);
});

// ---- Rename ---------------------------------------------------------------------

test("PATCH renames a team in the caller's org and 404s across the org boundary", async () => {
  signedInAs(admin);
  assert.equal((await renameRoute(req({ name: "Team A renamed" }), params({ id: teamA.id }))).status, 200);
  assert.equal(getWorkspace(teamA.id)?.name, "Team A renamed");

  // The rival's team exists, but a cross-org probe must not learn that.
  assert.equal((await renameRoute(req({ name: "Hijacked" }), params({ id: rivalTeam.id }))).status, 404);
  assert.equal(getWorkspace(rivalTeam.id)?.name, "Rival team", "untouched");
});

test("PATCH refuses a caller without team:manage", async () => {
  signedInAs(plain);
  assert.equal((await renameRoute(req({ name: "Nope" }), params({ id: teamA.id }))).status, 403);
});

// ---- Seat / unseat --------------------------------------------------------------

// Delegation is measured against what the actor holds ORG-WIDE, so these tests use
// actors nothing else promotes — the POST test above deliberately seats `admin` as
// an owner, which legitimately raises their ceiling.
const staffer = createUser({ orgId: ORG, email: "ws.staffer@csas.cz", name: "WS Staffer", status: "active", password: "staff-pw-1234" });
const target = createUser({ orgId: ORG, email: "ws.target@csas.cz", name: "WS Target", status: "active", password: "target-pw-123" });
upsertMembership(staffer.id, teamA.id, "admin"); // admin: members:manage + team:manage, never org:manage

test("an org admin seats somebody on a team the admin does not belong to", async () => {
  signedInAs(staffer); // staffer sits on teamA only
  assert.equal(getMembership(staffer.id, teamB.id), null, "precondition: no seat on team B");
  const r = await seatRoute(req({ role: "recruiter" }), params({ id: teamB.id, userId: target.id }));
  assert.equal(r.status, 200, "administrative authority is org-wide");
  assert.equal(getMembership(target.id, teamB.id)?.role, "recruiter");
});

test("a member can hold DIFFERENT roles on two teams at once", async () => {
  signedInAs(staffer);
  assert.equal((await seatRoute(req({ role: "viewer" }), params({ id: teamA.id, userId: target.id }))).status, 200);
  assert.equal(getMembership(target.id, teamA.id)?.role, "viewer");
  assert.equal(getMembership(target.id, teamB.id)?.role, "recruiter", "the other seat keeps its own role");
});

test("seating cannot hand out privilege the caller lacks", async () => {
  signedInAs(staffer); // admin everywhere, so members:manage — but never org:manage
  const r = await seatRoute(req({ role: "owner" }), params({ id: teamB.id, userId: target.id }));
  assert.equal(r.status, 403, "an admin cannot mint an owner");
  assert.equal(getMembership(target.id, teamB.id)?.role, "recruiter", "role unchanged by the refusal");
});

test("seating refuses a target user from another org", async () => {
  signedInAs(staffer);
  const r = await seatRoute(req({ role: "recruiter" }), params({ id: teamA.id, userId: rival.id }));
  assert.equal(r.status, 404, "another org's user is not a member of this roster");
  assert.equal(getMembership(rival.id, teamA.id), null);
});

test("a plain recruiter cannot seat anyone", async () => {
  const bystander = createUser({ orgId: ORG, email: "ws.bystander@csas.cz", name: "WS Bystander", status: "active", password: "by-pw-12345" });
  upsertMembership(bystander.id, teamA.id, "recruiter");
  signedInAs(bystander);
  assert.equal((await seatRoute(req({ role: "viewer" }), params({ id: teamA.id, userId: target.id }))).status, 403);
});

test("DELETE removes one seat and leaves the account and other seats alone", async () => {
  signedInAs(staffer);
  assert.equal((await unseatRoute(req(), params({ id: teamB.id, userId: target.id }))).status, 200);
  assert.equal(getMembership(target.id, teamB.id), null, "the seat is gone");
  assert.equal(getMembership(target.id, teamA.id)?.role, "viewer", "the other seat survives");
});

// ---- Switch: membership, not existence -------------------------------------------

test("switching into a team you have no seat on is refused", async () => {
  signedInAs(admin); // org admin, but no membership on team B
  const r = await switchRoute(req({ workspaceId: teamB.id }));
  assert.equal(r.status, 403, "administering a team is not the same as entering it");
});

test("switching into another org's team 404s, even for an owner", async () => {
  signedInAs(rival, rivalTeam.id);
  assert.equal((await switchRoute(req({ workspaceId: teamA.id }))).status, 404);
});

test("switching into a team you DO sit on succeeds and re-mints the cookie", async () => {
  signedInAs(plain);
  const r = await switchRoute(req({ workspaceId: teamA.id }));
  assert.equal(r.status, 200);
  assert.ok(r.headers.get("set-cookie")?.includes(SESSION_COOKIE), "the session is re-minted for the target team");
});

test("a session-less caller cannot switch at all", async () => {
  signedInAs(null);
  assert.equal((await switchRoute(req({ workspaceId: DEFAULT_WORKSPACE }))).status, 401);
});
