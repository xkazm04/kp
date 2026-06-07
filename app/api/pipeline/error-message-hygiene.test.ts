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
// (app/api/pipeline/).
const ROUTES = ["./route.ts", "./[id]/route.ts", "./events/route.ts"] as const;

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
