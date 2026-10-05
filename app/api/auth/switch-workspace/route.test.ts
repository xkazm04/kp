// The workspace switch is the one route that lets a caller CHOOSE which tenant
// their cookie is minted for, so every guard on it is load-bearing. This file
// pins the one that had no test: a DEMO session must not be able to leave the
// demo workspace.
//
// `/api/demo` is public and hands an anonymous visitor a validly-signed cookie
// with no `sub` and no `op`; the workspace id "demo" is the only thing that marks
// it as not-an-operator downstream (isOperator() in auth/require-operator.ts lets
// through every valid non-demo session). Switching used to skip its whole identity
// block for a claim-less session, so `{"workspaceId":"workspace"}` re-minted that
// cookie onto the real tenant and the visitor came back an operator.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import type { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

// Point next/server at the shared test shim BEFORE the route loads (hooks only
// affect later resolutions — hence the dynamic imports below).
register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// `next/headers` cannot run outside a Next request scope, so resolve it to a
// virtual module whose cookie jar this file drives.
const VIRTUAL_HEADERS = "kp-test:next-headers-switch-ws";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpSwitchWsTestCookie?: () => string | null }).__kpSwitchWsTestCookie = () => cookieValue;
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
            const value = globalThis.__kpSwitchWsTestCookie();
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

// A signing secret AND an operator password: without the password every caller
// folds to owner (open dev mode) and isOperator() is vacuously true.
process.env.KP_SECRET = "switch-ws-route-test-secret";
process.env.KP_OPERATOR_PASSWORD = "switch-ws-route-test-password";

const { POST: switchRoute } = await import("./route.ts");
const { signSession, DEFAULT_WORKSPACE, DEMO_WORKSPACE } = await import("../../../_lib/auth/session.ts");
const { isOperator } = await import("../../../_lib/auth/require-operator.ts");
const { createUser } = await import("../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../_lib/db/memberships.ts");

after(() => cleanupUnitDb());

const ORG = "org-default"; // the seeded org the default workspace belongs to

const req = (body?: unknown): NextRequest =>
  new Request("http://localhost/api/auth/switch-workspace", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as unknown as NextRequest;

test("an anonymous demo session cannot switch onto the real tenant (and become the operator)", async () => {
  // Exactly what GET /api/demo sets: a valid signature, workspace "demo", no claims.
  cookieValue = signSession(DEMO_WORKSPACE);
  assert.equal(await isOperator(), false, "precondition: a demo cookie is not an operator");

  const r = await switchRoute(req({ workspaceId: DEFAULT_WORKSPACE }));
  assert.equal(r.status, 403, "the guided demo must stay inside its own workspace");
  assert.equal(r.headers.get("set-cookie"), null, "no session is re-minted");

  // …and the escalation the refusal exists to prevent: had the switch succeeded the
  // visitor's cookie would sit on the default workspace, which is the ONLY thing
  // isOperator() looks at once a session verifies.
  cookieValue = signSession(DEFAULT_WORKSPACE);
  assert.equal(await isOperator(), true, "a claim-less cookie on the default workspace IS an operator — hence the guard above");

  cookieValue = null;
});

test("a real member with a seat still switches normally", async () => {
  const member = createUser({ orgId: ORG, email: "switch.member@csas.cz", name: "Switch Member", status: "active", password: "member-pw-12" });
  upsertMembership(member.id, DEFAULT_WORKSPACE, "recruiter");
  cookieValue = signSession(DEFAULT_WORKSPACE, Date.now(), { sub: member.id, org: ORG });

  const r = await switchRoute(req({ workspaceId: DEFAULT_WORKSPACE }));
  assert.equal(r.status, 200);
  assert.ok(r.headers.get("set-cookie")?.includes(SESSION_COOKIE), "the session is re-minted for the target team");

  cookieValue = null;
});

test("a caller with no session at all is still 401, not 403", async () => {
  cookieValue = null;
  assert.equal((await switchRoute(req({ workspaceId: DEFAULT_WORKSPACE }))).status, 401);
});

// ---- challenge-r04 auth-session-rbac/A: the renewal re-checks the principal ----------
//
// Switching is a RENEWAL: it re-mints a fresh 7-day token from a cookie the caller
// already holds. setMemberStatus('disabled') flips users.status but leaves the
// membership rows in place, so a door that checks only membership renewed an
// offboarded user's session forever, one POST a week.

test("a user disabled AFTER sign-in cannot renew through the switch: 401 and the cookie is cleared", async () => {
  const { setMemberStatus } = await import("../../../_lib/org-service.ts");
  const u = createUser({ orgId: ORG, email: "switch.disabled@csas.cz", name: "Switch Disabled", status: "active", password: "member-pw-12" });
  upsertMembership(u.id, DEFAULT_WORKSPACE, "recruiter");
  cookieValue = signSession(DEFAULT_WORKSPACE, Date.now(), { sub: u.id, org: ORG, role: "recruiter" });
  assert.equal(setMemberStatus(u.id, "disabled").ok, true, "precondition: the account is disabled, memberships untouched");

  const r = await switchRoute(req({ workspaceId: DEFAULT_WORKSPACE }));
  assert.equal(r.status, 401, "a disabled account may not renew its session");
  const lines = r.headers.getSetCookie();
  const session = lines.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  assert.ok(session, "the refusal answers a Set-Cookie for the session");
  assert.match(session, /^__Host-kp_session=;/, "…with an empty value");
  assert.match(session, /Max-Age=0/, "…that expires it now");
  cookieValue = null;
});

// ---- the renewal may not LAUNDER a revoked cookie (security scan b7518762) ----------
//
// This route is public (under the /api/auth/ prefix), so proxy.ts — the one place a
// revocation was consulted for an already-minted cookie — never runs on it. And a
// revocation names (principal, `iat`): an exact row names the OLD `iat`, and a
// "sign out all devices" cutoff matches `iat < cutoff`. A re-mint produces a NEW
// `iat` of now, so it escaped both shapes. One POST therefore turned a stolen,
// revoked cookie back into a live 7-day session — the laptop-theft case the
// revocation store exists for. The disabled-account test above does not cover it:
// "sign out all devices" deliberately leaves the account active.

test("a REVOKED cookie cannot re-mint itself through the switch: 401, cleared, and no new token", async () => {
  const { revokeAllSessions } = await import("../../../_lib/auth/session-revocation.ts");
  const u = createUser({ orgId: ORG, email: "switch.revoked@csas.cz", name: "Switch Revoked", status: "active", password: "member-pw-12" });
  upsertMembership(u.id, DEFAULT_WORKSPACE, "recruiter");
  const iat = Date.now();
  cookieValue = signSession(DEFAULT_WORKSPACE, iat, { sub: u.id, org: ORG, role: "recruiter" });

  // Non-vacuity: the very same cookie renews fine before the revocation, so the
  // refusal below cannot be a signature, expiry, membership or status failure.
  const ok = await switchRoute(req({ workspaceId: DEFAULT_WORKSPACE }));
  assert.equal(ok.status, 200, "precondition: this cookie renews while it is live");

  revokeAllSessions({ workspace: DEFAULT_WORKSPACE, sub: u.id }, "test:stolen-laptop", iat + 1);

  const r = await switchRoute(req({ workspaceId: DEFAULT_WORKSPACE }));
  assert.equal(r.status, 401, "a revoked session may not renew itself");
  const lines = r.headers.getSetCookie();
  const session = lines.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  assert.ok(session, "the refusal answers a Set-Cookie for the session");
  assert.match(session, /^__Host-kp_session=;/, "…with an empty value, so the laundering attempt costs the cookie");
  assert.match(session, /Max-Age=0/, "…that expires it now");
  // The property that actually matters: no fresh, UNREVOKED token came back.
  const { verifySession: verify } = await import("../../../_lib/auth/session.ts");
  assert.equal(verify(session!.split(";")[0].slice(SESSION_COOKIE.length + 1)), null, "nothing signable was issued");
  cookieValue = null;
});

// ---- a revoked cookie gets ONE refusal shape (security scan f727beae) ---------------
//
// proxy.ts states the doctrine: a missing, forged, expired or REVOKED session is refused
// identically, so a dead cookie cannot be used as an oracle. This route sits under the
// /api/auth/ public prefix (auth/public-routes.ts PUBLIC_API_PREFIXES), so the proxy
// never runs on it — and the revocation question used to be asked only at the very end,
// inside issueSession. Everything the handler decided on the way there answered FIRST:
// 404 for a workspace that does not exist, 404 for one owned by another org, 403 for one
// the caller holds no seat in, the lock's 403, and the 413 body cap. A stolen-and-revoked
// cookie could therefore still enumerate which workspaces exist, which of them belong to
// its org, and where its holder was a member — the laptop-theft case the revocation store
// exists for, reading the tenant map on its way out.
//
// Each case below is non-vacuous: the SAME cookie is first shown to get the distinguishing
// answer while it is live, so the 401 after the revocation cannot be a signature, expiry,
// membership or status failure.

const { revokeAllSessions, revokeSession } = await import("../../../_lib/auth/session-revocation.ts");
const { createWorkspace } = await import("../../../_lib/db/workspaces.ts");
const { createOrganization } = await import("../../../_lib/db/organizations.ts");

/** The body an absent cookie gets. Every refusal a revoked cookie receives must be this,
 *  byte for byte — that is the whole property. */
const UNIFORM_401_BODY = { error: "Sign in to switch workspaces." };

/** A live, switch-capable member cookie, plus the two revocation shapes that kill it. */
function liveMember(email: string, orgId: string = ORG) {
  const u = createUser({ orgId, email, name: email, status: "active", password: "member-pw-12" });
  upsertMembership(u.id, DEFAULT_WORKSPACE, "recruiter");
  const iat = Date.now();
  cookieValue = signSession(DEFAULT_WORKSPACE, iat, { sub: u.id, org: orgId, role: "recruiter" });
  const claims = { workspace: DEFAULT_WORKSPACE, sub: u.id, iat };
  return {
    user: u,
    iat,
    /** "sign out all devices" — the per-principal cutoff row. */
    revokeAll: () => revokeAllSessions(claims, "test:f727beae-stolen-laptop", iat + 1),
    /** "sign this device out" — the exact-`iat` row, the logout path's shape. */
    revokeThisOne: () => revokeSession(claims, "test:f727beae-logout", iat),
  };
}

async function assertUniform401(r: Response, what: string) {
  assert.equal(r.status, 401, `${what}: a revoked cookie must be refused like an absent one`);
  assert.deepEqual(await r.json(), UNIFORM_401_BODY, `${what}: …with the identical body, so it is no oracle`);
  const session = r.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  assert.ok(session, `${what}: the refusal answers a Set-Cookie for the session`);
  assert.match(session, /^__Host-kp_session=;/, `${what}: …with an empty value`);
  assert.match(session, /Max-Age=0/, `${what}: …that expires it now`);
}

/** Run `fn` with the deployment's multi-workspace lock OPEN, then restore it. The lock
 *  answers before the existence / org / membership guards, so those three are only
 *  reachable at all once it is off the path. */
async function withMultiWorkspace(fn: () => Promise<void>): Promise<void> {
  const prev = process.env.KP_MULTI_WORKSPACE;
  process.env.KP_MULTI_WORKSPACE = "1";
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env.KP_MULTI_WORKSPACE;
    else process.env.KP_MULTI_WORKSPACE = prev;
  }
}

test("the no-cookie refusal is the one shape the cases below must match", async () => {
  cookieValue = null;
  const r = await switchRoute(req({ workspaceId: DEFAULT_WORKSPACE }));
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), UNIFORM_401_BODY, "pins the body the revoked cases are compared against");
});

test("(a) a revoked cookie learns nothing about a workspace that does not exist", async () => {
  await withMultiWorkspace(async () => {
    const m = liveMember("switch.oracle.ghost@csas.cz");
    const phantom = "ws-does-not-exist-f727beae";

    const live = await switchRoute(req({ workspaceId: phantom }));
    assert.equal(live.status, 404, "precondition: a LIVE cookie is told the workspace is unknown");

    m.revokeAll();
    await assertUniform401(await switchRoute(req({ workspaceId: phantom })), "(a) unknown workspace");
    cookieValue = null;
  });
});

test("(b) a revoked cookie learns nothing about a workspace owned by another org", async () => {
  await withMultiWorkspace(async () => {
    const other = createOrganization("Foreign Org f727beae");
    const foreign = createWorkspace("Foreign Team", other.id);
    const m = liveMember("switch.oracle.foreign@csas.cz");

    const live = await switchRoute(req({ workspaceId: foreign.id }));
    assert.equal(live.status, 404, "precondition: a LIVE cookie is told a foreign-org team is unknown");

    // The exact-`iat` shape (the logout path), not just the cutoff.
    assert.equal(m.revokeThisOne(), true, "the exact-iat row was written");
    await assertUniform401(await switchRoute(req({ workspaceId: foreign.id })), "(b) foreign-org workspace");
    cookieValue = null;
  });
});

test("(c) a revoked cookie learns nothing about a same-org workspace it holds no seat in", async () => {
  await withMultiWorkspace(async () => {
    const sibling = createWorkspace("Sibling Team f727beae", ORG);
    const m = liveMember("switch.oracle.nonmember@csas.cz");

    const live = await switchRoute(req({ workspaceId: sibling.id }));
    assert.equal(live.status, 403, "precondition: a LIVE cookie is told it is not a member");

    m.revokeAll();
    await assertUniform401(await switchRoute(req({ workspaceId: sibling.id })), "(c) non-member workspace");
    cookieValue = null;
  });
});

test("(d) a revoked cookie learns nothing from the multi-workspace lock", async () => {
  // Lock OFF (the default), so any non-default target is refused by the lock itself —
  // before existence is even consulted.
  const locked = createWorkspace("Locked Target f727beae", ORG).id;
  const m = liveMember("switch.oracle.locked@csas.cz");

  const live = await switchRoute(req({ workspaceId: locked }));
  assert.equal(live.status, 403, "precondition: a LIVE cookie is told switching is disabled");

  m.revokeAll();
  await assertUniform401(await switchRoute(req({ workspaceId: locked })), "(d) the deployment lock");
  cookieValue = null;
});

test("(e) a revoked cookie learns nothing from the body-size cap", async () => {
  const m = liveMember("switch.oracle.payload@csas.cz");
  const oversized = { workspaceId: "x".repeat(6 * 1024) };

  const live = await switchRoute(req(oversized));
  assert.equal(live.status, 413, "precondition: a LIVE cookie is told the body is too large");

  m.revokeAll();
  await assertUniform401(await switchRoute(req(oversized)), "(e) the body-size cap");
  cookieValue = null;
});

test("a successful switch sets the session with the one attribute set and no entered marker", async () => {
  const u = createUser({ orgId: ORG, email: "switch.attrs@csas.cz", name: "Switch Attrs", status: "active", password: "member-pw-12" });
  upsertMembership(u.id, DEFAULT_WORKSPACE, "viewer");
  cookieValue = signSession(DEFAULT_WORKSPACE, Date.now(), { sub: u.id, org: ORG });
  const r = await switchRoute(req({ workspaceId: DEFAULT_WORKSPACE }));
  assert.equal(r.status, 200);
  const lines = r.headers.getSetCookie();
  assert.equal(lines.length, 1, "a renewal sets the session only, as it always did");
  const attrs = lines[0].split(";").slice(1).map((a) => a.trim().toLowerCase()).sort();
  assert.deepEqual(attrs, ["httponly", "max-age=604800", "path=/", "samesite=lax", "secure"]);
  const { verifySession } = await import("../../../_lib/auth/session.ts");
  const payload = verifySession(lines[0].split(";")[0].slice(SESSION_COOKIE.length + 1));
  assert.equal(payload?.sub, u.id);
  assert.equal(payload?.org, ORG, "org read from users.org_id");
  assert.equal(payload?.role, "viewer", "role read from the target membership");
  cookieValue = null;
});
