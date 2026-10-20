// sharedGetJson must keep a failed read's HTTP status as a VALUE: the shell's
// attention poll is the one periodic read that sees a lapsed session (401), and
// it can only report it if the status survives the rejection. The message stays
// "HTTP <status>" so every existing catch site reads what it always read.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { httpStatusOf, sharedGetJson } from "./sharedGet.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const stub = (status: number, body: unknown = {}) => {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
};

test("a 401 rejects with .status 401 and the unchanged 'HTTP 401' message", async () => {
  stub(401, { error: "Unauthorized" });
  await assert.rejects(sharedGetJson("/api/attention", { refresh: true }), (err: unknown) => {
    assert.ok(err instanceof Error);
    assert.equal(err.message, "HTTP 401");
    assert.equal((err as Error & { status?: number }).status, 401);
    assert.equal(httpStatusOf(err), 401);
    return true;
  });
});

test("any non-ok keeps its status; a network failure has none", async () => {
  stub(503);
  await assert.rejects(sharedGetJson("/api/x", { refresh: true }), (err: unknown) => httpStatusOf(err) === 503);
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await assert.rejects(sharedGetJson("/api/y", { refresh: true }), (err: unknown) => httpStatusOf(err) === null);
  assert.equal(httpStatusOf("nope"), null);
});

test("a 200 still resolves the parsed body", async () => {
  stub(200, { ok: 1 });
  assert.deepEqual(await sharedGetJson("/api/z", { refresh: true }), { ok: 1 });
});
