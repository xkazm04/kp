// The guided Google Calendar setup's door (client/route.ts), on a KEYLESS install in open
// mode: the save generates the calendar key into .env.local, the secret is never echoed,
// and the Connect door works straight after, in the same process, with no restart.
//
// `next/headers` cannot run outside a Next request scope, so `cookies()` resolves to a
// virtual module (the start/route.test.ts pattern). unit-db.ts must stay the first project
// import (isolated throwaway DB; it also clears KP_OPERATOR_PASSWORD, so open mode).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";

register(new URL("../../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const VIRTUAL_HEADERS = "kp-test:next-headers";
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
            return { get: () => undefined, set: () => {}, delete: () => {} };
          }
          export async function headers() { return new Headers(); }
          export async function draftMode() { return { isEnabled: false }; }
        `,
      };
    }
    return nextLoad(url, context);
  },
});

// Keyless: no session secret, no ATS key, no calendar key, no env client.
for (const k of ["KP_SECRET", "KP_ATS_SECRET_KEY", "KP_CALENDAR_SECRET_KEY", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]) {
  delete process.env[k];
}
process.env.APP_BASE_URL = "https://kp.example";
process.env.KP_TRUSTED_PROXY = "1";

// The launch directory is where .env.local is written: a scratch one, never the repo's.
const launchDir = mkdtempSync(path.join(tmpdir(), "kp-calendar-client-route-"));
const realCwd = process.cwd();
process.chdir(launchDir);

const { NextRequest } = await import("next/server");
const { GET, POST } = await import("./route.ts");
const { GET: start } = await import("../start/route.ts");
const { GET: status } = await import("../route.ts");
const { saveCalendarConnection, getRefreshToken } = await import("../../../../_lib/calendar/token-store.ts");

after(() => {
  process.chdir(realCwd);
  rmSync(launchDir, { recursive: true, force: true });
  cleanupUnitDb();
});

const ID = "1234-route.apps.googleusercontent.com";
const SECRET = "GOCSPX-route-test-secret-value";

const save = (body: unknown) =>
  POST(
    new NextRequest("https://kp.example/api/calendar/google/client", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
    })
  );

/** Every console line the route prints while `fn` runs, so a test can prove the secret is in none. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string }> {
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const grab = (...args: unknown[]) => lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" "));
  console.log = console.warn = console.error = console.info = grab;
  try {
    return { result: await fn(), logs: lines.join("\n") };
  } finally {
    Object.assign(console, orig);
  }
}

test("before setup: GET says not configured, with the redirect URI and scopes to register", async () => {
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.configured, false);
  assert.equal(body.source, null);
  assert.equal(body.clientId, null);
  assert.equal(body.redirectUriToRegister, "https://kp.example/api/calendar/google/callback");
  assert.ok(body.scopes.includes("https://www.googleapis.com/auth/calendar.freebusy"));
});

test("a bad body is refused with a reason code, never the submitted value", async () => {
  const res = await save({ clientId: "nope", clientSecret: SECRET });
  assert.equal(res.status, 400);
  const text = await res.text();
  assert.equal(JSON.parse(text).reason, "client_id_invalid");
  assert.equal(text.includes(SECRET), false);
  assert.equal(existsSync(path.join(launchDir, ".env.local")), false, "a refused request generates and persists no key");
  assert.equal(process.env.KP_CALENDAR_SECRET_KEY, undefined);
});

test("save + start works without a process restart, and the secret is echoed nowhere", async () => {
  const { result: res, logs } = await captureLogs(() => save({ clientId: ID, clientSecret: SECRET }));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text.includes(SECRET), false, "the response never carries the secret");
  assert.equal(logs.includes(SECRET), false, "and no log line does");
  const body = JSON.parse(text);
  assert.equal(body.ok, true);
  assert.equal(body.configured, true);
  assert.equal(body.source, "stored");
  assert.equal(body.clientId, ID);
  assert.equal(body.keyGenerated, true);

  // The key was persisted for the next start AND is live in this process now.
  const key = process.env.KP_CALENDAR_SECRET_KEY ?? "";
  assert.ok(key.length >= 43);
  const envLocal = readFileSync(path.join(launchDir, ".env.local"), "utf8");
  assert.ok(envLocal.includes(`KP_CALENDAR_SECRET_KEY=${key}`));
  assert.equal(envLocal.includes(SECRET), false, "the secret itself is never written to .env.local");
  assert.equal(process.env.KP_SECRET, undefined, "KP_SECRET was not created: the auth posture is unchanged");

  // Same process, no restart: the Connect door redirects into Google with the saved client.
  const go = await start(new NextRequest("https://kp.example/api/calendar/google/start", { headers: { "x-forwarded-for": "198.51.100.8" } }));
  assert.equal(go.status, 307);
  const consent = new URL(go.headers.get("location")!);
  assert.equal(consent.host, "accounts.google.com");
  assert.equal(consent.searchParams.get("client_id"), ID);
  assert.equal(go.headers.get("location")!.includes(SECRET), false);

  // ...and the callback's write (the grant) can be sealed under the same generated key.
  saveCalendarConnection({ tokens: { accessToken: "ya29.a", refreshToken: "1//r", expiresAt: new Date(Date.now() + 3600_000).toISOString(), scopes: [] } });
  assert.equal(getRefreshToken(), "1//r");

  // The status door agrees, and also never carries the secret.
  const st = await status();
  const stText = await st.text();
  assert.equal(JSON.parse(stText).configured, true);
  assert.equal(stText.includes(SECRET), false);
});

test("a second save reuses the key and never rewrites .env.local", async () => {
  const before = readFileSync(path.join(launchDir, ".env.local"), "utf8");
  const res = await save({ clientId: "5678-route.apps.googleusercontent.com", clientSecret: "" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.keyGenerated, false);
  assert.equal(body.clientId, "5678-route.apps.googleusercontent.com", "a blank secret kept the stored one");
  assert.equal(readFileSync(path.join(launchDir, ".env.local"), "utf8"), before);
  const get = await (await GET()).text();
  assert.equal(get.includes(SECRET), false);
  assert.deepEqual(Object.keys(JSON.parse(get)).sort(), ["clientId", "configured", "redirectUriToRegister", "savedUnreadable", "scopes", "source"]);
});
