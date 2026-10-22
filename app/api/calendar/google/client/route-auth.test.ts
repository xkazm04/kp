// The guided Google Calendar setup's door under a real auth posture (KP_SECRET + an
// operator password), driven against the REAL handlers:
//   • no session                → 401 on GET and POST, nothing stored
//   • a demo-sandbox session    → 401 (a signature is not an operator)
//   • a recruiter saving        → 403 FORBIDDEN_CAPABILITY (org:manage), nothing stored
//   • NON-VACUITY: an owner saves, and the response still never carries the secret
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";

register(new URL("../../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers-calendar-client-auth";
const SESSION_COOKIE = "__Host-kp_session";
let cookieValue: string | null = null;
(globalThis as { __kpCalendarClientCookie?: () => string | null }).__kpCalendarClientCookie = () => cookieValue;
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
            const value = globalThis.__kpCalendarClientCookie();
            return { get: (name) => (name === ${JSON.stringify(SESSION_COOKIE)} && value ? { name, value } : undefined), set: () => {}, delete: () => {} };
          }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

process.env.KP_SECRET = "calendar-client-auth-test-secret";
process.env.KP_OPERATOR_PASSWORD = "calendar-client-auth-test-password";
delete process.env.KP_CALENDAR_SECRET_KEY;
process.env.APP_BASE_URL = "https://kp.example";

// A scratch launch directory, so nothing here could ever write the repo's .env.local.
const launchDir = mkdtempSync(path.join(tmpdir(), "kp-calendar-client-auth-"));
const realCwd = process.cwd();
process.chdir(launchDir);

const { NextRequest } = await import("next/server");
const { GET, POST } = await import("./route.ts");
const { signSession, DEFAULT_WORKSPACE, DEMO_WORKSPACE } = await import("../../../../_lib/auth/session.ts");
const { createUser } = await import("../../../../_lib/db/users.ts");
const { upsertMembership } = await import("../../../../_lib/db/memberships.ts");
const { getStoredGoogleClientStatus } = await import("../../../../_lib/calendar/google-client-store.ts");

after(() => {
  process.chdir(realCwd);
  rmSync(launchDir, { recursive: true, force: true });
  cleanupUnitDb();
});

const SECRET = "GOCSPX-auth-test-secret-value";
const save = () =>
  POST(
    new NextRequest("https://kp.example/api/calendar/google/client", {
      method: "POST",
      body: JSON.stringify({ clientId: "1234-auth.apps.googleusercontent.com", clientSecret: SECRET }),
      headers: { "content-type": "application/json" },
    })
  );

const recruiter = createUser({ orgId: "org-default", email: "rec-cal@example.com", name: "Rec", status: "active", password: "correct horse battery" });
upsertMembership(recruiter.id, DEFAULT_WORKSPACE, "recruiter");
const owner = createUser({ orgId: "org-default", email: "own-cal@example.com", name: "Own", status: "active", password: "another secret pass" });
upsertMembership(owner.id, DEFAULT_WORKSPACE, "owner");

test("no session: 401 on GET and POST, and nothing is stored", async () => {
  cookieValue = null;
  assert.equal((await GET()).status, 401);
  const res = await save();
  assert.equal(res.status, 401);
  assert.equal((await res.text()).includes(SECRET), false);
  assert.equal(getStoredGoogleClientStatus(DEFAULT_WORKSPACE).saved, false);
});

test("a demo-sandbox session is not an operator", async () => {
  cookieValue = signSession(DEMO_WORKSPACE, Date.now());
  assert.equal((await GET()).status, 401);
  assert.equal((await save()).status, 401);
});

test("a recruiter cannot save the credential: coded 403 (org:manage), nothing stored", async () => {
  cookieValue = signSession(DEFAULT_WORKSPACE, Date.now(), { sub: recruiter.id, org: "org-default", role: "recruiter" });
  const res = await save();
  assert.equal(res.status, 403);
  const text = await res.text();
  assert.equal(text.includes(SECRET), false);
  const body = JSON.parse(text) as { code?: string; capability?: string };
  assert.equal(body.code, "FORBIDDEN_CAPABILITY");
  assert.equal(body.capability, "org:manage");
  assert.equal(getStoredGoogleClientStatus(DEFAULT_WORKSPACE).saved, false);
});

test("an owner saves; the answer never carries the secret, and KP_SECRET is untouched", async () => {
  cookieValue = signSession(DEFAULT_WORKSPACE, Date.now(), { sub: owner.id, org: "org-default", role: "owner" });
  const res = await save();
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text.includes(SECRET), false);
  const body = JSON.parse(text) as { configured: boolean; source: string; keyGenerated: boolean };
  assert.equal(body.configured, true);
  assert.equal(body.source, "stored");
  assert.equal(body.keyGenerated, false, "KP_SECRET already keys the store: nothing is generated");
  assert.equal(process.env.KP_SECRET, "calendar-client-auth-test-secret");
  assert.equal(process.env.KP_CALENDAR_SECRET_KEY, undefined);
  const get = await GET();
  assert.equal(get.status, 200);
  assert.equal((await get.text()).includes(SECRET), false);
});
