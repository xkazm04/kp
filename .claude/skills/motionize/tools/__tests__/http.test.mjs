/**
 * Fixtures for the tools' HTTP door. Before this, no fetch in the skill carried
 * a timeout, so a stalled provider hung the tool — and the agent run waiting on
 * its stdout — indefinitely and silently.
 *
 * Run: node --test .claude/skills/motionize/tools/__tests__/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { fetchWithTimeout, HttpTimeoutError, DEFAULT_TIMEOUT_MS } from "../http.mjs";

const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A server that accepts the connection and then never answers. */
function stalledServer() {
  const sockets = new Set();
  const server = createServer(() => {
    /* deliberately never responds: this is the failure mode being pinned */
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return {
    listen: () =>
      new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${server.address().port}/`))),
    close: () =>
      new Promise((ok) => {
        for (const s of sockets) s.destroy();
        server.close(ok);
      }),
  };
}

test("a stalled endpoint aborts on the budget instead of hanging forever", async () => {
  const srv = stalledServer();
  const url = await srv.listen();
  try {
    const started = Date.now();
    await assert.rejects(() => fetchWithTimeout(url, {}, 150), (err) => {
      assert.ok(err instanceof HttpTimeoutError, `expected HttpTimeoutError, got ${err?.name}`);
      assert.equal(err.timeoutMs, 150);
      assert.match(err.message, /timed out after 150ms/);
      return true;
    });
    assert.ok(Date.now() - started < 5000, "the abort must fire on the budget, not on a socket timeout");
  } finally {
    await srv.close();
  }
});

test("a caller's own abort stays the caller's, not a timeout", async () => {
  const srv = stalledServer();
  const url = await srv.listen();
  const ac = new AbortController();
  try {
    setTimeout(() => ac.abort(), 50);
    await assert.rejects(
      () => fetchWithTimeout(url, { signal: ac.signal }, 60_000),
      (err) => {
        assert.ok(!(err instanceof HttpTimeoutError), "a caller abort must not be relabelled as a timeout");
        return true;
      },
    );
  } finally {
    await srv.close();
  }
});

test("a responsive endpoint is untouched", async () => {
  const server = createServer((_req, res) => res.end("ok"));
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  try {
    const res = await fetchWithTimeout(`http://127.0.0.1:${server.address().port}/`, {}, 10_000);
    assert.equal(await res.text(), "ok");
  } finally {
    await new Promise((ok) => server.close(ok));
  }
});

test("no tool reaches the network without a budget", () => {
  assert.ok(DEFAULT_TIMEOUT_MS > 0);
  for (const file of readdirSync(TOOLS).filter((f) => f.endsWith(".mjs") && f !== "http.mjs")) {
    const src = readFileSync(resolve(TOOLS, file), "utf8");
    assert.doesNotMatch(src, /(?<!WithTimeout)\bfetch\(/, `${file} calls bare fetch() — use fetchWithTimeout`);
  }
});
