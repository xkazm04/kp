// UAT KAT-L1-002 — guards for the on-the-job rating surface.
//
// The rating is the most sensitive field this store has ever carried: a judgement
// about a NAMED PERSON who now works here, living in the same database as sealed
// decision records. Three properties have to hold, and none of them is visible in
// a behavioural test of the store:
//
//   1. both handlers take the shared operator gate before doing any work (the
//      authz-parity contract the sibling /api/pipeline routes already keep);
//   2. the rating never reaches a candidate-facing or unauthenticated surface —
//      most sharply the Activity feed, which is served UNAUTHENTICATED and would
//      carry the rating in `detail` if the write ever emitted a pipeline event;
//   3. no publicly-reachable route can read the outcome store at all.
//
// (3) is DERIVED from the fail-closed allow-list rather than hand-listed (drain
// method-commitment M3: a guard that asserts "every X is covered" reads its X from
// the source the producer consumes, or it is a dated snapshot that passes while the
// gap is live). Adding a new public prefix therefore extends this guard for free.
//
// Source-guard style mirrors ../batch/authz-parity.test.ts: route modules import via
// the "@/…" alias and pull in next/server, so the properties are asserted against the
// route SOURCE, which is exactly where they are stated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_API_EXACT, PUBLIC_API_PREFIXES } from "../../../_lib/auth/public-routes.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(HERE, "..", "..");
const ROUTE = readFileSync(resolve(HERE, "route.ts"), "utf8");

const GATE_IMPORT = /import\s*\{\s*requireOperator\s*\}\s*from\s*"@\/app\/_lib\/auth\/require-operator"/;
const GATE_CALL = /const\s+denied\s*=\s*await\s+requireOperator\(\)\s*;?\s*if\s*\(\s*denied\s*\)\s*return\s+denied\s*;?/;

test("both handlers are operator-gated, before any read or write", () => {
  assert.match(ROUTE, GATE_IMPORT, "must import the shared requireOperator gate");
  const getAt = ROUTE.indexOf("export async function GET");
  const postAt = ROUTE.indexOf("export async function POST");
  assert.ok(getAt >= 0 && postAt >= 0, "the route must export both GET and POST");

  const getBody = ROUTE.slice(getAt, postAt);
  const postBody = ROUTE.slice(postAt);
  assert.match(getBody, GATE_CALL, "the GET (one hire's rating / the workspace's hire counts) must be gated");
  assert.match(postBody, GATE_CALL, "the POST (records a judgement about a named person) must be gated");

  // The gate precedes the body read and every store call, so a refused caller never
  // reaches the write path.
  const gateAt = postBody.search(GATE_CALL);
  const bodyAt = postBody.indexOf("request.json()");
  const writeAt = postBody.indexOf("recordHirePerformance(");
  assert.ok(gateAt >= 0 && bodyAt > gateAt, "POST must gate before reading the request body");
  assert.ok(writeAt > gateAt, "POST must gate before writing the rating");
});

test("every store call is scoped to the caller's workspace", () => {
  assert.match(ROUTE, /const\s+ws\s*=\s*await\s+currentWorkspace\(\)/, "must resolve the caller's workspace");
  // The tenant-defaulting store functions this route calls; each must be handed `ws`
  // (they all default to DEFAULT_WORKSPACE_ID, so an omitted argument silently reads
  // or writes another team's hires — the exact class route-tenancy-coverage ratchets).
  for (const call of [
    /getPipelineEntry\([^)]*,\s*ws\)/,
    /latestOutcomeByRefs\(\[ref\],\s*ws\)/,
    /countRatedHires\(ws\)/,
    /listPipeline\(ws\)/,
    /recordHirePerformance\(entry,\s*parsed\.data\.performance,\s*ws\)/,
  ]) {
    assert.match(ROUTE, call, `tenant-scoped call missing: ${call}`);
  }
});

test("the write refuses a candidate who was never hired, against the LIVE stage", () => {
  // The cross-field rule of the store (performance rides a "hired" outcome only) is
  // re-derived server-side from the entry's current stage rather than trusted from a
  // client that may be holding a stale drawer.
  const postBody = ROUTE.slice(ROUTE.indexOf("export async function POST"));
  assert.match(postBody, /stageHasRole\(entry\.stage,\s*"terminal"/, "must check the terminal role server-side");
  // UPDATED DELIBERATELY (not relaxed): this read `/status:\s*409/` when the route
  // answered with an inline NextResponse.json({ error }). It now returns a CODED
  // refusal, because the i18n gate forbids leaking the server's canonical English
  // into a localized drawer and "why was this refused" is the useful half. The
  // assertion follows the refusal to its new shape, still pinning both halves:
  // the 409, and that the reason is a resolvable code rather than a bare string.
  assert.match(
    postBody,
    /jsonRefusal\(\s*"HIRE_RATING_NOT_HIRED"\s*,\s*409\s*\)/,
    "a non-hire must be refused with a coded 409, not silently recorded"
  );
});

test("the rating never enters the unauthenticated Activity feed", () => {
  // /api/pipeline/events is served without a session; its public projection copies
  // `detail` verbatim (pipeline-events-public.ts). A rating written as a pipeline
  // event would therefore be readable by anyone, so this route emits none.
  // Matched as CODE (a call or an import), not as text: the route's own comment
  // names these modules to explain why it stays away from them, and a guard that a
  // comment can trip is a guard people delete.
  for (const forbidden of [/recordPipelineEvent\s*\(/, /toPublicPipelineEvent\s*\(/, /from\s+"[^"]*pipeline-events/]) {
    assert.ok(!forbidden.test(ROUTE), `the rating write must not reach the public event feed (${forbidden})`);
  }
});

/** Every directory under app/api that the fail-closed gate lets an anonymous caller
 *  reach, derived from the allow-list itself. */
function publicApiDirs(): string[] {
  const paths = [...PUBLIC_API_PREFIXES, ...PUBLIC_API_EXACT]
    .map((p) => p.replace(/^\/api\//, "").replace(/\/$/, ""))
    .filter(Boolean);
  return [...new Set(paths)].map((rel) => resolve(API_DIR, rel)).filter((abs) => existsSync(abs));
}

function walkFiles(dir: string, out: string[] = []): string[] {
  if (!statSync(dir).isDirectory()) return [dir];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

test("no publicly-reachable route can read the on-the-job rating store", () => {
  const dirs = publicApiDirs();
  // A guard that scanned nothing would pass forever; pin that the allow-list actually
  // resolved to real route trees.
  assert.ok(dirs.length >= 5, `expected the public allow-list to resolve to route trees, got ${dirs.length}`);
  const offenders: string[] = [];
  for (const dir of dirs) {
    for (const file of walkFiles(dir)) {
      if (/from\s+"[^"]*dev-outcomes"/.test(readFileSync(file, "utf8"))) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, [], "an unauthenticated route imports the outcome store");
});
