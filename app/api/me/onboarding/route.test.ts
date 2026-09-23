// GET /api/me/onboarding answers who the wizard's saved draft belongs to (`scope`)
// and now also WHO IS ANSWERING (`seat`): the caller's own capability set, as the
// union of the two resolvers the wizard's finish doors gate on — callerOrgCapabilities
// (org name/currency/language, org:manage) and callerCapabilities (invites,
// pipeline, companion). The route stays ungated for the same reason
// /api/me/capabilities is: a principal asking what they themselves may do learns
// nothing they do not already hold, and nothing is created by asking.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers-me-onboarding";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpMeOnboardingCookie?: () => string | null }).__kpMeOnboardingCookie = () => cookieValue;
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
            const value = globalThis.__kpMeOnboardingCookie();
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

process.env.KP_SECRET = "me-onboarding-route-test-secret";
const PASSWORD = "me-onboarding-route-test-password";

const { GET } = await import("./route.ts");
const { signSession, DEFAULT_WORKSPACE } = await import("../../../_lib/auth/session.ts");
const { createUser } = await import("../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../_lib/db/memberships.ts");

after(() => {
  delete process.env.KP_OPERATOR_PASSWORD;
  cleanupUnitDb();
});

const ORG = "org-default";
const rita = createUser({ orgId: ORG, email: "rita-onb@example.com", name: "Rita", status: "active", password: "correct horse battery" });
upsertMembership(rita.id, DEFAULT_WORKSPACE, "recruiter");

async function read(): Promise<{ scope?: unknown; seat?: { capabilities?: unknown } }> {
  const res = await GET();
  assert.equal(res.status, 200);
  return (await res.json()) as { scope?: unknown; seat?: { capabilities?: unknown } };
}

test("open mode folds to the owner seat — org:manage and members:manage both held — and the scope is unchanged", async () => {
  delete process.env.KP_OPERATOR_PASSWORD;
  cookieValue = null;
  const body = await read();
  assert.equal(body.scope, `w:${DEFAULT_WORKSPACE}`);
  const caps = body.seat?.capabilities as string[];
  assert.ok(Array.isArray(caps));
  assert.ok(caps.includes("org:manage"), "the owner fold callerOrgCapabilities takes");
  assert.ok(caps.includes("members:manage"), "the owner fold callerCapabilities takes");
});

test("a recruiter's seat is what the finish doors will grant them — no org:manage, no members:manage", async () => {
  process.env.KP_OPERATOR_PASSWORD = PASSWORD;
  try {
    cookieValue = signSession(DEFAULT_WORKSPACE, Date.now(), { sub: rita.id, org: ORG, role: "recruiter" });
    const body = await read();
    assert.equal(body.scope, `u:${rita.id}`);
    assert.deepEqual([...(body.seat?.capabilities as string[])].sort(), ["pipeline:write", "read"]);
  } finally {
    delete process.env.KP_OPERATOR_PASSWORD;
    cookieValue = null;
  }
});
