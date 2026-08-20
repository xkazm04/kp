// Locks error-message hygiene across the pipeline-board endpoints
// (idea-66f52a3a), mirroring app/api/jds/error-message-hygiene.test.ts and
// app/api/interview/error-message-hygiene.test.ts: these routes sit directly on
// better-sqlite3, whose thrown errors carry SQLITE_* codes, constraint text and
// the absolute kp.sqlite path in `.message`. Forwarding that to the client is
// an information-disclosure leak. Every pipeline route must route its catch/500
// path through `safeJsonError`.
//
// These are source-level guards (the modules import via the "@/..." alias, which
// Node's test runner does not resolve), mirroring save-ingest-contract.test.ts.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

// Every pipeline route with a store-backed catch path, relative to this file
// (app/api/pipeline/). The list was a dated snapshot of three routes while the
// board grew five more store-backed handlers around them; each of those sits on
// the same better-sqlite3 errors, so each is held to the same rule.
const ROUTES = [
  "./route.ts",
  "./[id]/route.ts",
  "./[id]/consent/route.ts",
  "./[id]/timeline/route.ts",
  "./events/route.ts",
  "./batch/route.ts",
  "./command/route.ts",
  "./outcomes/route.ts",
  "./stage-impact/route.ts",
  "./stage-migration/route.ts",
] as const;

test("no pipeline route forwards a raw error message to the client", () => {
  for (const rel of ROUTES) {
    const src = read(rel);
    assert.doesNotMatch(
      src,
      /instanceof Error\s*\?\s*(?:error|err)\.message\s*:/,
      `${rel} must not forward a raw error message — route the catch through safeJsonError`,
    );
    assert.doesNotMatch(
      src,
      /\bjsonError\(/,
      `${rel} must not use jsonError (it forwards err.message) — use safeJsonError`,
    );
  }
});

test("every pipeline route routes its catch path through safeJsonError", () => {
  for (const rel of ROUTES) {
    const src = read(rel);
    assert.match(src, /safeJsonError/, `${rel} must use the shared safe-error responder`);
    assert.match(
      src,
      /from "@\/app\/_lib\/api-response"/,
      `${rel} must import the responder from the shared api-response module`,
    );
  }
});

/** The file with comments stripped, so a guard can only be tripped by CODE. The
 *  routes explain in prose exactly which leak they are avoiding ("Raw err.message
 *  surfaces better-sqlite3 internals…"), and a guard a comment can trip is a guard
 *  people delete — the same rule outcomes-route.test.ts keeps. */
function code(rel: string): string {
  return read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// The 500 body is not the only wire a caught error can ride out on. A pipeline
// event's `detail` is copied VERBATIM onto GET /api/pipeline/events — the
// unauthenticated Activity feed (pipeline-events-public.ts; the same property
// outcomes-route.test.ts pins for the hire rating) — and, unlike a 500, it is
// PERSISTED. The command bar leaked there: a rejection-comms failure recorded
// `…failed to queue — nudge manually. (${commsError.message})`, publishing
// SQLITE_* codes, constraint text and the absolute kp.sqlite path to anyone who
// could reach the origin, while the 500 path beside it was already clean.
//
// The rule that closes both doors at once: a pipeline route never reads an
// error's TEXT. Hand the error object to console (which formats it server-side)
// and a catalogue code to the caller; then there is no string to interpolate into
// a response, an event detail, or anything else added later.
test("no pipeline route reads a caught error's text", () => {
  for (const rel of ROUTES) {
    assert.doesNotMatch(
      code(rel),
      /\b\w*(?:err|Err)\w*\.message\b/,
      `${rel} must not read .message off an error — log the error object, record/return a stable message`,
    );
  }
});

test("the stable-code catalogue covers every pipeline failure path", () => {
  const src = read("../../_lib/api-response.ts");
  for (const code of [
    "PIPELINE_LIST_FAILED",
    "PIPELINE_CREATE_FAILED",
    "PIPELINE_ACTION_FAILED",
    "PIPELINE_EVENTS_FAILED",
  ]) {
    assert.match(src, new RegExp(code), `STORE_ERRORS must define a generic message for ${code}`);
  }
});
