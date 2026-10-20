// GET /api/me/capabilities is UNGATED by design (a caller asking what they may do
// learns nothing they do not hold), so the `session` facts it now carries for the
// shell's lapse warning must be the caller's OWN and nothing else: kind, user id,
// own email, workspace, token expiry. Never a hash, never another member's row,
// and null in open mode (nothing ever lapses there) or with no signed cookie.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers-me-capabilities";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpMeCapsCookie?: () => string | null }).__kpMeCapsCookie = () => cookieValue;
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
            const value = globalThis.__kpMeCapsCookie();
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

process.env.KP_SECRET = "me-capabilities-route-test-secret";
const PASSWORD = "me-capabilities-route-test-password";
process.env.KP_OPERATOR_PASSWORD = PASSWORD;

const { GET } = await import("./route.ts");
const { signSession, DEFAULT_WORKSPACE, DEMO_WORKSPACE, verifySession } = await import("../../../_lib/auth/session.ts");
const { createUser } = await import("../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../_lib/db/memberships.ts");

after(() => cleanupUnitDb());

const ORG = "org-default";
const ada = createUser({ orgId: ORG, email: "ada-caps@example.com", name: "Ada", status: "active", password: "correct horse battery" });
const bob = createUser({ orgId: ORG, email: "bob-caps@example.com", name: "Bob", status: "active", password: "another secret pass" });
upsertMembership(ada.id, DEFAULT_WORKSPACE, "recruiter");
upsertMembership(bob.id, DEFAULT_WORKSPACE, "owner");

async function read(): Promise<Record<string, unknown>> {
  const res = await GET();
  assert.equal(res.status, 200);
  return (await res.json()) as Record<string, unknown>;
}

test("a signed user cookie answers the caller's own session facts, expiry = the token's exp", async () => {
  process.env.KP_OPERATOR_PASSWORD = PASSWORD;
  const token = signSession(DEFAULT_WORKSPACE, Date.now(), { sub: ada.id, org: ORG, role: "recruiter" });
  cookieValue = token;
  const body = await read();
  assert.ok(Array.isArray(body.capabilities));
  assert.deepEqual(body.session, {
    kind: "user",
    userId: ada.id,
    email: "ada-caps@example.com",
    workspaceId: DEFAULT_WORKSPACE,
    expiresAt: verifySession(token)!.exp,
  });
  const wire = JSON.stringify(body);
  // Never a credential, never a colleague.
  assert.doesNotMatch(wire, /hash|password|scrypt/i);
  assert.doesNotMatch(wire, /bob-caps@example\.com/);
  assert.doesNotMatch(wire, new RegExp(bob.id));
});

test("an operator cookie answers kind 'operator' with no email and no user id", async () => {
  process.env.KP_OPERATOR_PASSWORD = PASSWORD;
  const token = signSession(DEFAULT_WORKSPACE, Date.now(), { op: true });
  cookieValue = token;
  const body = await read();
  assert.deepEqual(body.session, {
    kind: "operator",
    userId: null,
    email: null,
    workspaceId: DEFAULT_WORKSPACE,
    expiresAt: verifySession(token)!.exp,
  });
});

test("open mode (no operator password) answers session null, even with a signed cookie", async () => {
  delete process.env.KP_OPERATOR_PASSWORD;
  try {
    cookieValue = signSession(DEFAULT_WORKSPACE, Date.now(), { sub: ada.id, org: ORG, role: "recruiter" });
    const body = await read();
    assert.equal(body.session, null);
    assert.ok(Array.isArray(body.capabilities));
  } finally {
    process.env.KP_OPERATOR_PASSWORD = PASSWORD;
  }
});

test("no cookie, a demo cookie, or an identity-less non-operator cookie answer session null", async () => {
  process.env.KP_OPERATOR_PASSWORD = PASSWORD;
  cookieValue = null;
  assert.equal((await read()).session, null);
  cookieValue = signSession(DEMO_WORKSPACE, Date.now());
  assert.equal((await read()).session, null);
  cookieValue = signSession(DEFAULT_WORKSPACE, Date.now());
  assert.equal((await read()).session, null);
});
