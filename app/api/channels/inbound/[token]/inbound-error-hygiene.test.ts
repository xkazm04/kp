// The PUBLIC inbound-lead webhook (POST /api/channels/inbound/[token]) is
// session-less — its only credential is the channel token, so its caller is
// unauthenticated. It sits on better-sqlite3 plus a spawned CV extractor
// (ingestCvApplication), whose thrown errors embed SQLITE_* constraint codes, the
// absolute db path and Python tracebacks. Its 500 catch used to return that raw
// `error.message` whole. The sibling public token routes (/api/apply,
// /api/agents/report/[token]) already answer generically via safeJsonError; this
// route now does the same, so the last public-webhook leak of this class is closed.
//
// Source-contract test (the repo pattern — see apply-error-hygiene.test.ts):
// importing the route or api-response.ts would pull in `next/server`, which the
// unit runner cannot resolve, so the contract is pinned over the source instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("the public inbound webhook answers its 500 through safeJsonError", () => {
  const src = readFileSync(path.join(HERE, "route.ts"), "utf8");
  assert.match(
    src,
    /safeJsonError\(error, "api:channels\/inbound", "CHANNEL_INBOUND_FAILED"\)/,
    "the inbound webhook must use the safe 500 responder",
  );
  // The leak itself: a thrown error's own message shaped into a client envelope.
  assert.ok(
    !/NextResponse\.json\(\s*\{\s*error:[^}]*instanceof Error\s*\?/.test(src),
    "route.ts still shapes a thrown error's message into a response body",
  );
});

test("CHANNEL_INBOUND_FAILED is a generic, client-safe message in the shared catalog", () => {
  const src = readFileSync(path.join(HERE, "..", "..", "..", "..", "_lib", "api-response.ts"), "utf8");
  assert.match(src, /CHANNEL_INBOUND_FAILED: "[^"]+"/, "the code must exist with a generic message");
});
