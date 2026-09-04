// Pins the Decisions queue's load refusal: a code and a status, never the
// server's English prose — and pins the tab's half of it by reading the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { foldQueueLoadThrow, readQueueResponse } from "./decisionsQueueLoad.ts";

test("a body with entries reads through with no failure", () => {
  const read = readQueueResponse({ entries: [{ id: "a" }], stages: [] });
  assert.equal(read.failure, null);
  assert.equal(read.entries?.length, 1);
});

test("an empty queue is entries, not a failure", () => {
  const read = readQueueResponse({ entries: [] });
  assert.deepEqual(read.entries, []);
  assert.equal(read.failure, null);
});

test("a body carrying error+code folds to the CODE, and the prose is dropped", () => {
  const read = readQueueResponse({ error: "SqliteError: no such table: pipeline", code: "PIPELINE_LIST_FAILED" });
  assert.equal(read.entries, null);
  assert.equal(read.failure?.code, "PIPELINE_LIST_FAILED");
  assert.equal(JSON.stringify(read.failure).includes("SqliteError"), false, "the thrown message never rides in the failure");
});

test("a gated seat's 403 keeps the capability so the reason can name it", () => {
  const read = readQueueResponse({ error: "Your role does not allow this action.", code: "FORBIDDEN_CAPABILITY", capability: "pipeline:read" });
  assert.deepEqual(read.failure, { code: "FORBIDDEN_CAPABILITY", capability: "pipeline:read", status: 200 });
});

test("a body with neither entries nor error is a failed read, not an empty queue", () => {
  assert.equal(readQueueResponse({}).entries, null);
  assert.equal(readQueueResponse(null).entries, null);
  assert.equal(readQueueResponse("nope").entries, null);
  assert.equal(readQueueResponse(null).failure?.status, null, "nothing arrived, so no status is claimed");
});

test("a thrown HTTP status is recovered; any other throw carries no code at all", () => {
  assert.deepEqual(foldQueueLoadThrow(new Error("HTTP 503")), { code: null, capability: null, status: 503 });
  assert.deepEqual(foldQueueLoadThrow(new TypeError("Failed to fetch")), { code: null, capability: null, status: null });
  assert.equal(foldQueueLoadThrow("boom").code, null, "a thrown string is not a code");
});

// The hook and the tab are .tsx/.ts with no component runner here, so their half
// of the contract is pinned by reading the source (decisionsRulesLoad.test.ts's
// technique). CRLF-normalized: this checkout is CRLF, the worktree may be LF.
const src = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the queue hook resolves a code and never throws or paints the server string", () => {
  const hook = src("useDecisionsQueue.ts");
  assert.doesNotMatch(hook, /throw new Error\(p\.error\)/, "the server's prose is not re-thrown");
  assert.doesNotMatch(hook, /setError\(e instanceof Error \? e\.message/, "…and not painted");
  assert.match(hook, /readQueueResponse\(p\)/, "the body is folded");
  assert.match(hook, /capabilityAwareReason\(errMsg, read\.failure, t\("loadFailed"\)\)/, "the code is resolved in the reader's language");
  assert.match(hook, /capabilityAwareReason\(errMsg, foldQueueLoadThrow\(e\), t\("loadFailed"\)\)/, "…on the thrown path too");
});
