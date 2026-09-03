// The binary half of the authorization layer — "is this a trusted operator?" — and
// until now the file that decides it had NO test at all. `isOperator()` is what the
// public JD page asks before rendering Edit/Archive/Revert, and `requireOperator()`
// is the defense-in-depth gate on the routes that write provider secrets and spawn
// Python. Its contract is not obvious (open mode is a YES; a valid demo cookie is a
// NO), and every clause of it was previously held by prose alone.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { cleanupUnitDb } from "../testing/unit-db.ts";

// `next/headers` needs a Next request scope; `next/server` resolves to two module
// identities through a worktree's node_modules junction (see next-server-shim.mjs).
// Redirect both before the modules under test are dynamically imported.
const VIRTUAL_HEADERS = "kp-test:next-headers";
const SESSION_COOKIE = "__Host-kp_session";
const NEXT_SERVER_SHIM = new URL("../testing/next-server-shim.mjs", import.meta.url).href;
let cookieValue: string | null = null;
(globalThis as { __kpOperatorCookie?: () => string | null }).__kpOperatorCookie = () => cookieValue;

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
            const value = globalThis.__kpOperatorCookie();
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

process.env.KP_SECRET = "require-operator-test-secret";

const { isOperator, requireOperator } = await import("./require-operator.ts");
const { signSession, DEMO_WORKSPACE, SESSION_TTL_MS } = await import("./session.ts");

after(() => cleanupUnitDb());

const TEAM = "ws_operator_test";
function withCookie(token: string | null): void {
  cookieValue = token;
}
function passwordMode(on: boolean): void {
  if (on) process.env.KP_OPERATOR_PASSWORD = "operator-test-password";
  else delete process.env.KP_OPERATOR_PASSWORD;
}

test("OPEN MODE (no operator password) trusts every caller — the local-dev contract", async () => {
  passwordMode(false);
  withCookie(null);
  assert.equal(await isOperator(), true);
  assert.equal(await requireOperator(), null, "no gate to fail when the app itself is open");
});

test("password mode with no cookie is a 401, not a crash", async () => {
  passwordMode(true);
  withCookie(null);
  assert.equal(await isOperator(), false);
  const denied = await requireOperator();
  assert.equal(denied?.status, 401);
  assert.deepEqual(await denied?.json(), { error: "Unauthorized" });
});

test("a forged or tampered cookie is a 401", async () => {
  passwordMode(true);
  const good = signSession(TEAM, Date.now(), { op: true });
  withCookie("not.a.session");
  assert.equal(await isOperator(), false);
  withCookie(good.slice(0, -3) + "aaa"); // same shape, broken signature
  assert.equal(await isOperator(), false);
  assert.equal((await requireOperator())?.status, 401);
});

test("an EXPIRED session is a 401 — the signature alone is never enough", async () => {
  passwordMode(true);
  withCookie(signSession(TEAM, Date.now() - SESSION_TTL_MS - 60_000, { op: true }));
  assert.equal(await isOperator(), false);
});

test("a valid operator session passes", async () => {
  passwordMode(true);
  withCookie(signSession(TEAM, Date.now(), { op: true }));
  assert.equal(await isOperator(), true);
  assert.equal(await requireOperator(), null);
});

test("a signed-in MEMBER passes too — this gate is proxy-equivalent, not owner-only", async () => {
  // Deliberate: requireOperator mirrors proxy.ts ("any valid session"), and the
  // per-user question is current-user.ts's requireCapability. A test that demanded
  // 403 here would be pinning a policy this file does not implement.
  passwordMode(true);
  withCookie(signSession(TEAM, Date.now(), { sub: "usr_member", org: "org-default", role: "recruiter" }));
  assert.equal(await isOperator(), true);
});

test("CRITICAL: an anonymous DEMO session is signed, valid — and not an operator", async () => {
  // /api/demo is public and mints a real signature for the "demo" workspace, so the
  // proxy lets it through. Without this clause that anonymous cookie would satisfy
  // the whole-DB export/import routes: an exfiltration channel anyone could open.
  passwordMode(true);
  withCookie(signSession(DEMO_WORKSPACE, Date.now(), {}));
  assert.equal(await isOperator(), false);
  assert.equal((await requireOperator())?.status, 401);
});

test("a demo session is still refused when it carries identity claims", async () => {
  passwordMode(true);
  withCookie(signSession(DEMO_WORKSPACE, Date.now(), { sub: "usr_x", org: "org-default", op: true }));
  assert.equal(await isOperator(), false, "the WORKSPACE decides this, not the claims");
});
