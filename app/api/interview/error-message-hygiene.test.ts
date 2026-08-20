// Locks error-message hygiene across the voice-interview endpoints
// (idea-ab117371), mirroring app/api/jds/error-message-hygiene.test.ts: these
// catch paths sit behind better-sqlite3, the scorecard automation AND the voice
// provider adapters, whose thrown errors embed upstream HTTP bodies (OpenAI
// client_secrets / ElevenLabs signed-url responses) plus SQLite/fs internals.
// Forwarding `error.message` to the client — which `jsonError` does — hands an
// attacker the db path, schema constraint names and provider error bodies.
// Every interview route must route its catch/500 path through `safeJsonError`.
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

// Every interview route with a store/adapter-backed catch path, relative to
// this file (app/api/interview/).
// The list started with the five routes that had already been converted, which
// left the interview-MINTING sibling /simulate outside the guard — and it was
// still on `jsonError`, forwarding better-sqlite3's `err.message` (db path,
// constraint names) from createInterviewSession + the billing-state read. The
// rule is per-ROUTE, not per-conversion-batch, so every interview route with a
// store-backed catch is listed here; adding a route means adding it here.
const ROUTES = [
  "./create/route.ts",
  "./connect/route.ts",
  "./complete/route.ts",
  "./by-entry/route.ts",
  "./compare/route.ts",
  "./revoke/route.ts",
  "./simulate/route.ts",
  "./simulate/attach/route.ts",
  "../interview-prep/route.ts",
] as const;

test("no interview route forwards a raw error message to the client", () => {
  for (const rel of ROUTES) {
    const src = read(rel);
    // The leak pattern that used to live in these catch blocks (directly, or
    // via jsonError, which forwards err.message verbatim).
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

test("every interview route routes its catch path through safeJsonError", () => {
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

test("the stable-code catalogue covers every interview failure path", () => {
  const src = read("../../_lib/api-response.ts");
  for (const code of [
    "INTERVIEW_CREATE_FAILED",
    "INTERVIEW_CONNECT_FAILED",
    "INTERVIEW_COMPLETE_FAILED",
    "INTERVIEW_LOOKUP_FAILED",
    "INTERVIEW_PREP_FAILED",
  ]) {
    assert.match(src, new RegExp(code), `STORE_ERRORS must define a generic message for ${code}`);
  }
});
