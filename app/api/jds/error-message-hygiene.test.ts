// Locks error-message hygiene across the SQLite-backed JD & template endpoints
// (idea-c6bf88c9): a thrown better-sqlite3 / fs error carries raw internal detail
// in its `.message` ("SQLITE_CORRUPT", "UNIQUE constraint failed: jds.slug", the
// absolute db path). POST /api/jds always guarded against forwarding that, but its
// siblings forwarded `error.message` straight to the client — an information-
// disclosure leak. Every store-backed handler must now route its 500/catch path
// through the shared `safeJsonError`, which logs full detail server-side and
// returns only a generic message + stable code.
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

// Every store-backed route, relative to this file (app/api/jds/).
const ROUTES = [
  "./route.ts",
  "./[slug]/route.ts",
  "./[slug]/analyses/route.ts",
  "./save/route.ts",
  "../templates/route.ts",
  "../templates/[id]/route.ts",
] as const;

test("no JD/template route forwards a raw error message to the client", () => {
  for (const rel of ROUTES) {
    const src = read(rel);
    // The leak pattern that used to live in these catch blocks. Forwarding
    // `error.message`/`err.message` is exactly what exposes SQLite/fs internals.
    assert.doesNotMatch(
      src,
      /instanceof Error\s*\?\s*(?:error|err)\.message/,
      `${rel} must not forward a raw error message — route the catch through safeJsonError`,
    );
  }
});

test("every store-backed route routes its catch path through safeJsonError", () => {
  for (const rel of ROUTES) {
    const src = read(rel);
    // The CALL, not a bare mention: a route that keeps the import but answers its
    // catch some other way satisfied `/safeJsonError/` while leaking again.
    assert.match(src, /return safeJsonError\(/, `${rel} must RETURN the shared safe-error responder from its catch`);
    assert.match(
      src,
      /from "@\/app\/_lib\/api-response"/,
      `${rel} must import the responder from the shared api-response module`,
    );
  }
});

test("safeJsonError logs server-side and returns a generic message + stable code, never err.message", () => {
  const src = read("../../_lib/api-response.ts");
  assert.match(src, /export function safeJsonError/, "the shared responder must exist");
  // Full detail is logged server-side only...
  assert.match(src, /console\.error\(/, "safeJsonError must log the full error server-side");
  // ...and the client gets exactly the catalogue's generic message plus the
  // stable code — pinning this shape proves the raw error message is never the
  // payload (anything else, e.g. `err.message`, would fail this match).
  assert.match(
    src,
    /NextResponse\.json\(\{\s*error:\s*STORE_ERRORS\[code\],\s*code\s*\}/,
    "safeJsonError must return only the generic catalogue message + stable code, never the raw error",
  );
});

test("the stable-code catalogue covers every JD/template failure path", () => {
  const src = read("../../_lib/api-response.ts");
  for (const code of [
    "JD_LIST_FAILED",
    "JD_LOAD_FAILED",
    "JD_SAVE_FAILED",
    "JD_ANALYSES_FAILED",
    "TEMPLATE_LIST_FAILED",
    "TEMPLATE_LOAD_FAILED",
    "TEMPLATE_CREATE_FAILED",
    "TEMPLATE_UPDATE_FAILED",
    "TEMPLATE_DELETE_FAILED",
  ]) {
    assert.match(src, new RegExp(code), `STORE_ERRORS must define a generic message for ${code}`);
  }
});
