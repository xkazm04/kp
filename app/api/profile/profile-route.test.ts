// The profile SAVE door — the one Python-subprocess door in the app that carried no
// budget, no body cap and no coded failures.
//
// Every accepted POST/PUT here spawns `pipeline.jobfit.profile_cli` and writes a row.
// The route is not operator-gated (the editor is a workspace surface), so in open mode
// — or through the anonymous session /api/demo mints — it was an unbounded
// process-spawn endpoint reachable by anyone who could open the app. Its body was
// `await request.json()` with no cap, buffered whole before being written into the
// child's input file. And all four handlers answered `{ error: <the thrown message> }`,
// i.e. the temp workdir path, PYTHON_CMD, and better-sqlite3's SQLITE_* text with the
// absolute db path — rendered verbatim by the editor in every locale.
//
// NON-VACUITY: against the pre-fix route every assertion below fails. The 429 cases
// reached the spawn and answered 200/500; the 413 cases parsed the oversized body and
// spawned; the source guard found four `NextResponse.json({ error: message })` catches
// where it now requires `safeJsonError`.
//
// The two behavioural cases deliberately never reach the spawn: the limiter and the cap
// both refuse BEFORE `routeAndScore`, which is the property being pinned.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { rateLimit } from "../../_lib/rate-limit.ts";

// Point next/server at the shared test shim BEFORE the route loads.
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

after(() => {
  delete process.env.KP_TRUSTED_PROXY;
  cleanupUnitDb();
});

type Route = typeof import("./route.ts");
let route: Route | null = null;
async function handlers(): Promise<Route> {
  route ??= (await import("./route.ts")) as Route;
  return route;
}

/** The route's own budget, restated here so a widening of the constant is a red test
 *  rather than a silently larger burst. The limiter key is the route's, verbatim. */
const PROFILE_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };
const MAX_PROFILE_BODY_BYTES = 128_000;

let ip = 0;
function addr(): string {
  return `10.7.0.${++ip}`;
}

function req(method: "POST" | "PUT", body: unknown, client: string): Request {
  return new Request("http://localhost/api/profile", {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": client },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Spend the whole window on this client through the REAL in-process limiter with the
 *  route's exact key and config — so the next call from the same address is the 429
 *  branch, without making 60 real requests (each of which would spawn a child). */
function exhaust(client: string): void {
  for (let i = 0; i < PROFILE_RATE_LIMIT.limit; i += 1) {
    assert.ok(rateLimit(`profile-save:${client}`, PROFILE_RATE_LIMIT), `hit ${i + 1} must pass under the limit`);
  }
}

beforeEach(() => {
  delete process.env.KP_OPERATOR_PASSWORD;
  // Without a trusted hop clientIpFrom collapses every caller into one bucket
  // (rate-limit.ts, "THE TRAP"), so per-IP behaviour is only observable with one.
  process.env.KP_TRUSTED_PROXY = "1";
});

for (const method of ["POST", "PUT"] as const) {
  test(`${method} /api/profile refuses a burst through the shared chokepoint — never a spawn`, async () => {
    const h = await handlers();
    const client = addr();
    exhaust(client);
    const res = await h[method](req(method, { id: "p-1", profile: {} }, client) as never);
    assert.equal(res.status, 429);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, "TOO_MANY_REQUESTS", "the throttle answers a machine code, not English prose");
  });

  test(`${method} /api/profile caps the body it buffers and says how big is too big`, async () => {
    const h = await handlers();
    const client = addr();
    // Valid JSON, comfortably over the cap: the refusal must be about SIZE, measured
    // on the bytes read, not about the shape.
    const oversized = JSON.stringify({ id: "p-1", profile: { displayName: "x".repeat(MAX_PROFILE_BODY_BYTES + 1_000) } });
    assert.ok(oversized.length > MAX_PROFILE_BODY_BYTES, "the fixture must actually exceed the cap");
    const res = await h[method](req(method, oversized, client) as never);
    assert.equal(res.status, 413);
    const body = (await res.json()) as { code?: string; maxBytes?: number };
    assert.equal(body.code, "PAYLOAD_TOO_LARGE");
    assert.equal(body.maxBytes, MAX_PROFILE_BODY_BYTES, "the cap rides as DATA so the editor can say it in the reader's language");
  });
}

// A source guard, because the alternative is provoking a store fault in four handlers.
// Line endings normalised: this checkout is CRLF and the worktree may be LF.
test("all four handlers answer a CODE, never the thrown error's own message", () => {
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  for (const call of [
    'safeJsonError(error, "api:profile:list", "PROFILE_LIST_FAILED")',
    'safeJsonError(error, "api:profile:create", "PROFILE_BUILD_FAILED")',
    'safeJsonError(error, "api:profile:update", "PROFILE_UPDATE_FAILED")',
    'safeJsonError(error, "api:profile:delete", "PROFILE_DELETE_FAILED")',
  ]) {
    assert.ok(src.includes(call), `expected the coded responder:\n  ${call}`);
  }
  assert.ok(
    !/error instanceof Error \? error\.message/.test(src),
    "no handler may shape the thrown message into the client body",
  );
});

test("the candidate matrix read answers a code too", () => {
  const src = readFileSync(new URL("./candidates/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(src.includes('safeJsonError(error, "api:profile:candidates", "PROFILE_CANDIDATES_FAILED")'));
  assert.ok(!/error instanceof Error \? error\.message/.test(src));
});

// The save budget and the CLI deadline are both single-sourced, not re-typed.
test("the CLI deadline is imported from applicant-profile, not hand-copied", () => {
  const src = readFileSync(new URL("./route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.ok(src.includes('import { PROFILE_BUILD_TIMEOUT_MS } from "@/app/_lib/applicant-profile"'));
  assert.ok(src.includes("const PROFILE_ROUTE_TIMEOUT_MS = PROFILE_BUILD_TIMEOUT_MS;"));
});
