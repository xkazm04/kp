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
  assert.ok(src.includes('safeJsonError(new Error(outcome.error.message), "api:profile:create", "PROFILE_BUILD_FAILED", outcome.error.status)'));
  assert.ok(src.includes('safeJsonError(new Error(outcome.error.message), "api:profile:update", "PROFILE_UPDATE_FAILED", outcome.error.status)'));
  assert.ok(!src.includes('NextResponse.json({ error: outcome.error.message }'), "the CLI stderr must remain in the server log");
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

// ---- One profile per CV (challenge-r03 candidate-profile/A) --------------------------
//
// A profile built FROM an analysis carries the CV's content hash (source_cv_hash). A
// second build from any analysis of the SAME CV used to INSERT a second profile row
// unconditionally — the matrix kept offering "build profile" on the analysis chip, and
// every click filed another. The server now refuses it by name, with the existing
// profile's id as data so the client can open it instead. The identity join is
// workspace-scoped, and a dry-run preview is never refused.

type Stores = {
  analyses: typeof import("../../_lib/db/analyses.ts");
  profiles: typeof import("../../_lib/db/profiles.ts");
  ws: string;
};
async function stores(): Promise<Stores> {
  const analyses = await import("../../_lib/db/analyses.ts");
  const profiles = await import("../../_lib/db/profiles.ts");
  const { DEFAULT_WORKSPACE_ID } = await import("../../_lib/db/workspaces.ts");
  return { analyses, profiles, ws: DEFAULT_WORKSPACE_ID };
}

function seedAnalysis(s: Stores, cvHash: string, workspaceId: string): string {
  return s.analyses.saveAnalysis(
    { candidateLabel: "Jana Novak", jdSlug: null, score: 80, roleFamily: null, seniority: null, payload: {}, cvHash },
    workspaceId
  ).slug;
}

const PROFILE_INPUT = { label: "Jana Novak", archetype: "bau", roleFamily: null, completeness: 50, payload: {} };

test("POST refuses a second profile for a CV this workspace already profiled: 409 PROFILE_EXISTS + the existing id", async () => {
  const h = await handlers();
  const s = await stores();
  const first = seedAnalysis(s, "cv-hash-dup", s.ws);
  const existing = s.profiles.saveProfile(PROFILE_INPUT, s.ws, {
    sourceAnalysisSlug: first,
    sourceCvHash: "cv-hash-dup",
    sourceAnalyzedAt: new Date().toISOString(),
  });
  // A NEWER analysis of the same CV (e.g. against another JD) — the build target.
  const newer = seedAnalysis(s, "cv-hash-dup", s.ws);
  const before = s.profiles.listProfiles(1000, s.ws).length;

  const res = await h.POST(req("POST", { persist: true, sourceAnalysisSlug: newer, profile: { displayName: "Jana" } }, addr()) as never);
  assert.equal(res.status, 409);
  const body = (await res.json()) as { code?: string; id?: string };
  assert.equal(body.code, "PROFILE_EXISTS");
  assert.equal(body.id, existing.id, "the refusal names the profile to open instead");
  assert.equal(s.profiles.listProfiles(1000, s.ws).length, before, "no row was inserted");
});

test("the identity join never crosses tenants: a same-CV profile in ANOTHER workspace does not refuse", async () => {
  const h = await handlers();
  const s = await stores();
  const other = "ws-profile-exists-other";
  const foreign = seedAnalysis(s, "cv-hash-cross", other);
  s.profiles.saveProfile(PROFILE_INPUT, other, {
    sourceAnalysisSlug: foreign,
    sourceCvHash: "cv-hash-cross",
    sourceAnalyzedAt: new Date().toISOString(),
  });
  const mine = seedAnalysis(s, "cv-hash-cross", s.ws);
  const before = s.profiles.listProfiles(1000, s.ws).length;

  const res = await h.POST(req("POST", { persist: true, sourceAnalysisSlug: mine, profile: { displayName: "Jana" } }, addr()) as never);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { saved?: { id?: string } | null };
  assert.ok(body.saved?.id, "a new profile was saved in this workspace");
  assert.equal(s.profiles.listProfiles(1000, s.ws).length, before + 1);
});

test("a dry-run preview (persist:false) is never refused, even when the CV already has a profile", async () => {
  const h = await handlers();
  const s = await stores();
  const first = seedAnalysis(s, "cv-hash-preview", s.ws);
  s.profiles.saveProfile(PROFILE_INPUT, s.ws, {
    sourceAnalysisSlug: first,
    sourceCvHash: "cv-hash-preview",
    sourceAnalyzedAt: new Date().toISOString(),
  });
  const newer = seedAnalysis(s, "cv-hash-preview", s.ws);
  const before = s.profiles.listProfiles(1000, s.ws).length;

  const res = await h.POST(req("POST", { persist: false, sourceAnalysisSlug: newer, profile: { displayName: "Jana" } }, addr()) as never);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { saved?: unknown };
  assert.equal(body.saved, null, "a preview saves nothing");
  assert.equal(s.profiles.listProfiles(1000, s.ws).length, before);
});
