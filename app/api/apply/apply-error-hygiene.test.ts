// The two PUBLIC apply submissions are anonymous-facing, and both sit on
// better-sqlite3, a Python profile-build subprocess, an fs temp write and the
// comms dispatcher. Their catch blocks used to return the raw `err.message`,
// which for that stack means SQLITE_* codes, absolute db/temp paths and Python
// tracebacks handed to whoever POSTed. The sibling /api/status token route
// already answers generically via safeJsonError; these now do the same.
//
// Source-contract test (the repo pattern — see quick-apply-status-link.test.ts):
// importing the routes or api-response.ts would pull in `next/server`, which the
// unit runner cannot resolve, so the contract is pinned over the source instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

test("both public apply routes answer their 500 through safeJsonError", () => {
  for (const [rel, tag] of [
    ["[id]/route.ts", "api:apply"],
    ["[id]/quick/route.ts", "api:apply:quick"],
  ] as const) {
    const src = read(rel);
    assert.match(src, new RegExp(`safeJsonError\\(error, "${tag}", "APPLY_FAILED"\\)`), `${rel} must use the safe 500 responder`);
    // The leak itself: a thrown error's own message shaped into a client envelope.
    assert.ok(
      !/NextResponse\.json\(\s*\{\s*error:[^}]*instanceof Error\s*\?/.test(src),
      `${rel} still shapes a thrown error's message into a response body`
    );
  }
});

test("safeJsonError's body is the generic message + code — the raw error only reaches the log", () => {
  const src = readFileSync(path.join(HERE, "..", "..", "_lib", "api-response.ts"), "utf8");
  assert.match(
    src,
    /export function safeJsonError\([\s\S]*?\)\s*:\s*NextResponse\s*\{\s*console\.error\([^)]*\);\s*return NextResponse\.json\(\{ error: STORE_ERRORS\[code\], code \}, \{ status \}\);/,
    "the safe responder must log the raw error and return ONLY the generic message + code"
  );
  assert.match(src, /APPLY_FAILED: "[^"]+"/, "APPLY_FAILED is a generic, client-safe message in the shared catalog");
  // Non-vacuity: the leaky sibling still exists (jsonError forwards err.message),
  // so the assertion above is about which one the apply routes chose.
  assert.match(src, /export function jsonError[\s\S]*?err instanceof Error \? err\.message/, "jsonError is still the message-forwarding variant");
});

test("the deliberate human-written 4xx validation copy is untouched", () => {
  // These are client-safe by construction and tell the applicant what to fix —
  // adopting safeJsonError must not have swept them up.
  const conversational = read("[id]/route.ts");
  assert.match(conversational, /"Your name is too long\."/);
  assert.match(conversational, /"Please enter a valid email address\."/);
  assert.match(conversational, /"Application payload too large\."/);
  const quick = read("[id]/quick/route.ts");
  assert.match(quick, /"Please enter your name\."/);
  assert.match(quick, /"Please enter a valid email address\."/);
});
