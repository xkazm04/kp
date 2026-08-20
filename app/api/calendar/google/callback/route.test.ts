// Pins the ONE-SHOT property of the Google-Calendar OAuth state cookie.
//
// The callback documents "clear it whatever happens, so a replayed callback cannot reuse
// it". A cookie is identified by (name, PATH): `start/route.ts` sets `kp_gcal_state` at
// /api/calendar/google, and `jar.delete(name)` — the form this route shipped with —
// serializes Path=/ because @edge-runtime/cookies' normalizeCookie fills in "/" whenever a
// path is absent. That expires a cookie that never existed and leaves the real one alive
// for the rest of its 10-minute TTL, so a second callback carrying the same state still
// passed the check. Both halves are guarded here: the cookie MECHANISM (behavioural, over
// the real serializer Next ships) and the two call sites AGREEING on the path (source).
//
// Route modules import via the "@/..." alias, which Node's test runner does not resolve —
// so, mirroring rate-limit-contract.test.ts, the route halves are checked at source level.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const { ResponseCookies } = require_("next/dist/compiled/@edge-runtime/cookies") as {
  ResponseCookies: new (headers: Headers) => {
    delete(...args: [string] | [{ name: string; path?: string }]): unknown;
  };
};

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const callback = read("./route.ts");
const start = read("../start/route.ts");

const STATE_PATH = "/api/calendar/google";

function deletionHeader(arg: [string] | [{ name: string; path?: string }]): string {
  const headers = new Headers();
  new ResponseCookies(headers).delete(...arg);
  return headers.get("set-cookie") ?? "";
}

test("deleting by NAME ALONE cannot clear a path-scoped cookie", () => {
  // Non-vacuity for the fix below: this is exactly what the pre-fix callback emitted.
  const byName = deletionHeader(["kp_gcal_state"]);
  assert.match(byName, /Path=\//);
  assert.doesNotMatch(byName, new RegExp(`Path=${STATE_PATH}`), "Path=/ never matches the cookie stored at " + STATE_PATH);

  const withPath = deletionHeader([{ name: "kp_gcal_state", path: STATE_PATH }]);
  assert.ok(withPath.includes(`Path=${STATE_PATH}`), "repeating the path targets the cookie that actually exists");
  assert.match(withPath, /Expires=Thu, 01 Jan 1970/, "and still expires it");
});

test("the state cookie is SET and DELETED at the same path", () => {
  // The path lives in one exported constant precisely so these two cannot drift.
  assert.ok(start.includes(`export const OAUTH_STATE_COOKIE_PATH = "${STATE_PATH}"`), "start/route.ts owns the path constant");
  assert.ok(start.includes("path: OAUTH_STATE_COOKIE_PATH"), "the cookie is set at that path");
  assert.ok(
    callback.includes("jar.delete({ name: OAUTH_STATE_COOKIE, path: OAUTH_STATE_COOKIE_PATH })"),
    "the callback deletes with the same path"
  );
  // Forbid the old form outright — it type-checks, lints clean, and silently does nothing.
  assert.doesNotMatch(callback, /jar\.delete\(\s*OAUTH_STATE_COOKIE\s*\)/, "delete(name) alone must never come back");
});

test("state is compared constant-time and every rejection redirects, never 500s", () => {
  // The surrounding contract the fix must not disturb.
  assert.ok(callback.includes("timingSafeEqual"), "constant-time state compare");
  assert.ok(callback.includes('return back(base, "state_mismatch")'), "a mismatch is an outcome code, not a raw error");
});
