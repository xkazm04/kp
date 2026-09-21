// Pins POST /api/decisions/screen-wave error envelopes: every non-2xx body
// carries a code and never forwards a thrown message (SQLITE_* / path / English
// error.message as the client string). Source contract for the 500; live 400/409
// against the handler in open mode.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { NextRequest } from "next/server";
import { POST } from "./route.ts";

after(() => cleanupUnitDb());

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "route.ts"), "utf8").replace(/\r\n/g, "\n");

function jsonPost(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/decisions/screen-wave", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function assertCoded(body: { code?: unknown; error?: unknown }, code: string) {
  assert.equal(body.code, code);
  assert.equal(typeof body.error, "string");
  const blob = JSON.stringify(body);
  assert.doesNotMatch(blob, /SQLITE/i);
  assert.doesNotMatch(blob, /kp\.sqlite/);
  assert.doesNotMatch(blob, /jobId is required/);
  assert.doesNotMatch(blob, /Screen wave failed/);
}

test("the 500 catch answers through safeJsonError, never error.message", () => {
  assert.match(src, /safeJsonError\(error, "api:decisions\/screen-wave", "SCREEN_WAVE_FAILED"\)/);
  assert.doesNotMatch(src, /error instanceof Error \? error\.message/);
  assert.doesNotMatch(src, /error: error\.message/);
  assert.doesNotMatch(src, /error: checked\.error/);
});

test("missing jobId and a malformed override are jsonRefusal 400s with a code", () => {
  assert.match(src, /jsonRefusal\("SCREEN_WAVE_JOB_REQUIRED", 400\)/);
  assert.match(src, /jsonRefusal\("DECISION_CONFIG_INVALID", 400, \{ detail: checked\.error \}\)/);
});

test("a 409 approval refusal keeps reason and adds a SCREEN_WAVE_APPROVAL_* code", () => {
  assert.match(src, /jsonRefusal\(SCREEN_WAVE_APPROVAL_CODES\[error\.reason\], 409, \{ reason: error\.reason \}\)/);
  for (const reason of ["required", "expired", "mismatch", "spent", "unattributed"]) {
    assert.match(src, new RegExp(`${reason}: "SCREEN_WAVE_APPROVAL_${reason.toUpperCase()}"`));
  }
});

test("open mode: missing jobId is 400 SCREEN_WAVE_JOB_REQUIRED", async () => {
  const res = await POST(jsonPost({}));
  assert.equal(res.status, 400);
  assertCoded(await res.json(), "SCREEN_WAVE_JOB_REQUIRED");
});

test("open mode: a non-object override is 400 DECISION_CONFIG_INVALID", async () => {
  const res = await POST(jsonPost({ jobId: "job-1", override: [] }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assertCoded(body, "DECISION_CONFIG_INVALID");
  assert.equal(typeof body.detail, "string");
});

test("open mode: a commit without approval is 409 with reason and a code", async () => {
  const res = await POST(jsonPost({ jobId: "job-1", dryRun: false }));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(typeof body.code, "string");
  assert.match(String(body.code), /^SCREEN_WAVE_APPROVAL_/);
  assert.equal(typeof body.reason, "string");
  assertCoded(body, body.code as string);
});
