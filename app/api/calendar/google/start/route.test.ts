// The door that begins a Google Calendar authorization. It had no test at all, while
// carrying three things that are only ever wrong in production: the flags on a cookie that
// holds a CSRF state (and now the PKCE verifier), the rate limit that bounds an
// unauthenticated-in-open-mode redirect into Google's endpoint from this deployment's
// address, and — new here — the PKCE challenge itself.
//
// `next/headers` cannot run outside a Next request scope, so `cookies()` resolves to a
// virtual module whose jar this file drives (the org-routes.test.ts / workspaces-route
// pattern). unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register, registerHooks } from "node:module";
import { cleanupUnitDb } from "../../../../_lib/testing/unit-db.ts";

register(new URL("../../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

type SetCookie = { name: string; value: string; options: Record<string, unknown> };
const jar: SetCookie[] = [];
(globalThis as { __kpCalendarStartJar?: SetCookie[] }).__kpCalendarStartJar = jar;

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
            return {
              get: () => undefined,
              set: (name, value, options) => { globalThis.__kpCalendarStartJar.push({ name, value, options: options ?? {} }); },
              delete: () => {},
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

// An HTTPS origin, so `secure` is asserted at its production value rather than at the
// localhost one — a state cookie that rides plaintext is the whole point of the flag.
process.env.APP_BASE_URL = "https://kp.example";
// One trusted proxy hop, so `clientIpFrom` reads the forwarded address instead of folding
// every caller into the ONE shared bucket it uses when nothing is trusted (rate-limit.ts's
// documented trap). That gives each test below its own limiter bucket.
process.env.KP_TRUSTED_PROXY = "1";
process.env.GOOGLE_OAUTH_CLIENT_ID = "cid.apps.googleusercontent.com";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";

const { NextRequest } = await import("next/server");
const { GET, OAUTH_STATE_COOKIE, OAUTH_STATE_COOKIE_PATH } = await import("./route.ts");
const { decodeOAuthState } = await import("../../../../_lib/calendar/google-oauth.ts");

after(() => cleanupUnitDb());
beforeEach(() => {
  jar.length = 0;
});

/** Each test uses its own client IP so the in-process limiter buckets cannot bleed
 *  between them (the limiter is keyed per IP, deliberately). */
function start(ip: string): Promise<Response> {
  return GET(new NextRequest("https://kp.example/api/calendar/google/start", { headers: { "x-forwarded-for": ip } }));
}

test("the state cookie is httpOnly, secure, lax, path-scoped and short-lived", async () => {
  const res = await start("203.0.113.10");
  assert.equal(res.status, 307, "a redirect into Google's consent screen");
  assert.equal(jar.length, 1);
  const cookie = jar[0];
  assert.equal(cookie.name, OAUTH_STATE_COOKIE);
  assert.equal(cookie.options.httpOnly, true, "script must never read the state or the verifier");
  assert.equal(cookie.options.secure, true, "an https deployment sends it over TLS only");
  assert.equal(cookie.options.sameSite, "lax", "must survive the top-level redirect back from Google");
  assert.equal(cookie.options.path, OAUTH_STATE_COOKIE_PATH, "(name, path) is the cookie's identity — the callback deletes at this path");
  assert.equal(cookie.options.maxAge, 600, "a consent round trip is seconds; a long-lived state is a longer forgery window");
});

test("the cookie carries the PKCE verifier, and Google is sent only its S256 digest", async () => {
  const res = await start("203.0.113.11");
  const held = decodeOAuthState(jar[0].value);
  assert.ok(held, "the cookie decodes into state + verifier");
  assert.ok(held.state.length >= 40, "32 random bytes of CSRF state");
  assert.ok(held.verifier.length >= 43, "an RFC 7636 verifier");

  const params = new URL(res.headers.get("location")!).searchParams;
  assert.equal(params.get("state"), held.state, "the state Google echoes is the one in the cookie");
  assert.equal(params.get("code_challenge_method"), "S256");
  assert.equal(
    params.get("code_challenge"),
    createHash("sha256").update(held.verifier).digest("base64url"),
    "the challenge is the digest — the verifier itself never leaves the deployment"
  );
  assert.equal(res.headers.get("location")!.includes(held.verifier), false, "and it is nowhere in the redirect URL");
});

test("a fresh state and verifier per authorization", async () => {
  await start("203.0.113.12");
  await start("203.0.113.13");
  assert.notEqual(jar[0].value, jar[1].value);
});

test("an unconfigured deployment gets an actionable 503, not a Google error screen", async () => {
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  try {
    const res = await start("203.0.113.14");
    assert.equal(res.status, 503);
    const body = (await res.json()) as { needed: string[]; redirectUriToRegister: string };
    assert.deepEqual(body.needed, ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]);
    assert.equal(body.redirectUriToRegister, "https://kp.example/api/calendar/google/callback");
    assert.equal(jar.length, 0, "and no state cookie is minted for a flow that cannot start");
  } finally {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "cid.apps.googleusercontent.com";
  }
});

test("the limiter bounds the door — and a throttled caller gets no stale state cookie", async () => {
  const ip = "203.0.113.20";
  // 30 per 10 minutes per IP (OAUTH_START_RATE_LIMIT). Every hit mints a state, SETS a
  // cookie and redirects a browser at Google's endpoint from this deployment's address,
  // and the operator gate above is a documented no-op in open mode — so this is the real
  // bound. Pinned as a call site by app/api/rate-limit-contract.test.ts.
  for (let i = 0; i < 30; i++) {
    assert.equal((await start(ip)).status, 307, `request ${i + 1} is within the budget`);
  }
  const minted = jar.length;
  const refused = await start(ip);
  assert.equal(refused.status, 429);
  assert.equal((await refused.json()).code, "TOO_MANY_REQUESTS", "a refusal CODE, never a raw message");
  assert.equal(jar.length, minted, "the throttled request set no cookie — it never reached the mint");
});
