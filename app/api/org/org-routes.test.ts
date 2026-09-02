// The ORG's own doors: who may mint an invite, at what role, and who may edit a
// seat's permissions — driven through the REAL handlers on a throwaway SQLite file.
//
// Until this file existed, /api/org/invites had NO route test at all: its three
// refusals (a malformed address, a role above the caller's ceiling, an already-active
// member) were unpinned, and so was the delegation rule that stops an admin minting
// an `owner` invite and accepting it themselves — the invite twin of the PATCH
// escalation app/api/org/members/[userId]/delegation-delta.test.ts already covers.
// All three now answer with a machine CODE, which is what the console renders, so the
// codes are part of the contract and asserted here.
//
// The permissions PATCH is pinned for the other reason: it was a read→compute→write
// with two awaits between the SELECT and the UPDATE and no precondition on either
// side, so two administrators editing one member raced last-writer-wins in silence.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope, so the auth helpers degrade
// to open mode. These tests are ABOUT the authority decision, so resolve it to a
// virtual module whose cookie jar this file drives (workspaces-route.test.ts pattern).
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpOrgTestCookie?: () => string | null }).__kpOrgTestCookie = () => cookieValue;
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
            const value = globalThis.__kpOrgTestCookie();
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
process.env.KP_SECRET = "org-routes-test-secret";
process.env.KP_OPERATOR_PASSWORD = "org-routes-test-password";

const { GET: listInvites, POST: mintInvite } = await import("./invites/route.ts");
const { DELETE: revokeInviteRoute } = await import("./invites/[token]/route.ts");
const { PATCH: patchMember } = await import("./members/[userId]/route.ts");
const { createWorkspace } = await import("../../_lib/db/workspaces.ts");
const { createUser } = await import("../../_lib/db/users.ts");
const { upsertMembership, getMembership, setMembershipOverrides } = await import("../../_lib/db/memberships.ts");
const { getInvite } = await import("../../_lib/db/invites.ts");
const { roleCapabilities } = await import("../../_lib/auth/roles.ts");
const { signSession } = await import("../../_lib/auth/session.ts");

after(() => cleanupUnitDb());

const ORG = "org-default"; // the seeded org the default workspace belongs to
const OTHER_ORG = "org-rival";

const team = createWorkspace("Org routes team", ORG);
const rivalTeam = createWorkspace("Rival team", OTHER_ORG);

const owner = createUser({ orgId: ORG, email: "org.owner@csas.cz", name: "Org Owner", status: "active", password: "owner-pw-1234" });
const admin = createUser({ orgId: ORG, email: "org.admin@csas.cz", name: "Org Admin", status: "active", password: "admin-pw-1234" });
const plain = createUser({ orgId: ORG, email: "org.plain@csas.cz", name: "Org Plain", status: "active", password: "plain-pw-1234" });
const rival = createUser({ orgId: OTHER_ORG, email: "org.rival@rival.test", name: "Org Rival", status: "active", password: "rival-pw-1234" });

upsertMembership(owner.id, team.id, "owner");
upsertMembership(admin.id, team.id, "admin");
upsertMembership(plain.id, team.id, "recruiter");
upsertMembership(rival.id, rivalTeam.id, "owner");

function signedInAs(user: { id: string; orgId: string } | null, workspace = team.id): void {
  cookieValue = user === null ? null : signSession(workspace, Date.now(), { sub: user.id, org: user.orgId });
}

const req = (body?: unknown, method = "POST"): NextRequest =>
  new Request("http://localhost/api/org", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;

const params = <T,>(p: T) => ({ params: Promise.resolve(p) });
type OrgBody = { code?: string; error?: string; invite?: { token: string }; invites?: { token: string }[] };
const bodyOf = async (r: Response): Promise<OrgBody> => (await r.json()) as OrgBody;

// ---- POST /api/org/invites ------------------------------------------------------

test("a recruiter cannot mint an invite at all", async () => {
  signedInAs(plain);
  const r = await mintInvite(req({ email: "new.hire@csas.cz", role: "recruiter", workspaceId: team.id }));
  assert.equal(r.status, 403, "minting a capability link is members:manage");
});

test("a session-less caller cannot mint an invite", async () => {
  signedInAs(null);
  assert.equal((await mintInvite(req({ email: "new.hire@csas.cz" }))).status, 401);
});

test("a malformed address is refused with a CODE, not an English sentence", async () => {
  signedInAs(admin);
  const r = await mintInvite(req({ email: "not-an-address", workspaceId: team.id }));
  assert.equal(r.status, 400);
  assert.equal((await bodyOf(r)).code, "INVITE_EMAIL_INVALID", "the console renders the code, never the server's string");
});

test("an admin cannot invite AT owner — the delegation ceiling covers the invite path too", async () => {
  signedInAs(admin); // members:manage + team:manage, never org:manage
  const r = await mintInvite(req({ email: "would.be.owner@csas.cz", role: "owner", workspaceId: team.id }));
  assert.equal(r.status, 403, "inviting at a role grants that role's capabilities");
  assert.equal((await bodyOf(r)).code, "INVITE_ROLE_ABOVE_PRIVILEGE");
});

test("an owner CAN invite at owner — the ceiling is narrow, not a blanket ban", async () => {
  signedInAs(owner);
  const r = await mintInvite(req({ email: "second.owner@csas.cz", role: "owner", workspaceId: team.id }));
  assert.equal(r.status, 200);
  assert.equal(getInvite((await bodyOf(r)).invite!.token)?.role, "owner");
});

test("re-inviting an already-active member is refused with its own code", async () => {
  signedInAs(admin);
  const r = await mintInvite(req({ email: plain.email, workspaceId: team.id }));
  assert.equal(r.status, 409);
  assert.equal((await bodyOf(r)).code, "INVITE_ALREADY_MEMBER", "the remedy is 'they should sign in', not 'try again'");
});

test("inviting onto ANOTHER org's team 404s — a cross-org probe learns nothing", async () => {
  signedInAs(admin);
  const r = await mintInvite(req({ email: "stranger@csas.cz", workspaceId: rivalTeam.id }));
  assert.equal(r.status, 404);
});

// ---- GET /api/org/invites -------------------------------------------------------

test("GET lists the org's pending invites, and refuses a recruiter", async () => {
  signedInAs(admin);
  const r = await listInvites();
  assert.equal(r.status, 200);
  assert.ok(((await bodyOf(r)).invites ?? []).length > 0, "the invites minted above are pending");

  signedInAs(plain);
  assert.equal((await listInvites()).status, 403, "viewing invites is part of managing members");
});

// ---- DELETE /api/org/invites/[token] --------------------------------------------

test("an admin revokes a pending invite; a second revoke is a 409", async () => {
  signedInAs(admin);
  const minted = await bodyOf(await mintInvite(req({ email: "revoke.me@csas.cz", workspaceId: team.id })));
  const token = minted.invite!.token;
  assert.equal((await revokeInviteRoute(req(undefined, "DELETE"), params({ token }))).status, 200);
  assert.notEqual(getInvite(token)?.status, "pending", "the link no longer redeems");
  assert.equal((await revokeInviteRoute(req(undefined, "DELETE"), params({ token }))).status, 409, "already revoked");
});

test("another org's invite cannot be revoked by guessing its token", async () => {
  signedInAs(admin);
  const mine = await bodyOf(await mintInvite(req({ email: "mine@csas.cz", workspaceId: team.id })));
  signedInAs(rival, rivalTeam.id);
  assert.equal((await revokeInviteRoute(req(undefined, "DELETE"), params({ token: mine.invite!.token }))).status, 404);
  assert.equal(getInvite(mine.invite!.token)?.status, "pending", "untouched");
});

test("a recruiter cannot revoke", async () => {
  signedInAs(admin);
  const minted = await bodyOf(await mintInvite(req({ email: "safe@csas.cz", workspaceId: team.id })));
  signedInAs(plain);
  assert.equal((await revokeInviteRoute(req(undefined, "DELETE"), params({ token: minted.invite!.token }))).status, 403);
});

// ---- PATCH /api/org/members/[userId] — the permissions race ----------------------

test("a permissions save that lost the race is refused, not silently applied", async () => {
  const target = createUser({ orgId: ORG, email: "race.target@csas.cz", name: "Race Target", status: "active", password: "race-pw-1234" });
  upsertMembership(target.id, team.id, "recruiter");
  signedInAs(owner);

  // Administrator A opened the dialog on the seat as it was: pure role defaults.
  const seenByA: string[] = [...roleCapabilities("recruiter")];

  // Administrator B saves first — granting a capability A never saw.
  const b = await patchMember(
    req({ workspaceId: team.id, capabilities: [...seenByA, "members:manage"], expectedCapabilities: seenByA }),
    params({ userId: target.id })
  );
  assert.equal(b.status, 200, "the first writer wins on the snapshot they actually read");
  assert.ok(getMembership(target.id, team.id)?.overrides?.grant.includes("members:manage"));

  // Administrator A now saves the set THEY loaded. Last-writer-wins would erase B's
  // grant with no error at all; the compare-and-swap refuses instead.
  const a = await patchMember(
    req({ workspaceId: team.id, capabilities: seenByA, expectedCapabilities: seenByA }),
    params({ userId: target.id })
  );
  assert.equal(a.status, 409, "the seat moved under the editor");
  assert.equal(((await a.json()) as { code?: string }).code, "MEMBER_PERMISSIONS_CHANGED");
  assert.ok(
    getMembership(target.id, team.id)?.overrides?.grant.includes("members:manage"),
    "the refusal wrote NOTHING — B's grant survives"
  );
});

test("a save whose snapshot still matches the live seat goes through", async () => {
  const target = createUser({ orgId: ORG, email: "calm.target@csas.cz", name: "Calm Target", status: "active", password: "calm-pw-1234" });
  upsertMembership(target.id, team.id, "recruiter");
  signedInAs(owner);
  const current = [...roleCapabilities("recruiter")];
  const r = await patchMember(
    req({ workspaceId: team.id, capabilities: [...current, "members:manage"], expectedCapabilities: current }),
    params({ userId: target.id })
  );
  assert.equal(r.status, 200);
  assert.ok(getMembership(target.id, team.id)?.overrides?.grant.includes("members:manage"));
});

test("without a snapshot the route still re-asserts the row IT read", async () => {
  // An API caller that sends no `expectedCapabilities` is not exempted from the
  // precondition: the fingerprint falls back to the membership this request itself
  // selected, so the window between that SELECT and the UPDATE is still guarded.
  const target = createUser({ orgId: ORG, email: "bare.target@csas.cz", name: "Bare Target", status: "active", password: "bare-pw-1234" });
  upsertMembership(target.id, team.id, "recruiter");
  setMembershipOverrides(target.id, team.id, { grant: ["members:manage"], revoke: [] });
  signedInAs(owner);
  const r = await patchMember(
    req({ workspaceId: team.id, capabilities: [...roleCapabilities("recruiter")] }),
    params({ userId: target.id })
  );
  assert.equal(r.status, 200, "nothing moved during the request, so the revoke lands");
  assert.equal(getMembership(target.id, team.id)?.overrides, null, "back to pure role defaults");
});
