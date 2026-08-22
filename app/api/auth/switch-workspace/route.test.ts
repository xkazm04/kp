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
