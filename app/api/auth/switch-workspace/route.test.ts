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
