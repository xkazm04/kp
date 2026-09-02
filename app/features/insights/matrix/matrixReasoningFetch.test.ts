// grid-narrative-says-what-it-is (b). Driven with a fetch double — no network, no React.
//
// The behaviour under test is the one the popover could not previously express: a
// CANCELLED reasoning request is neither a success nor a failure. Before the split the
// fetch lived inline in useMatrixTab with no signal at all, so closing the popover left
// an LLM-backed Python spawn running and its answer landed in a state nobody would read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchMatchReasoning, isAbortError } from "./matrixReasoningFetch.ts";

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

test("a 200 resolves to ok and carries source / cached / narrativeLang through", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const out = await fetchMatchReasoning(
    { profileId: "p1", jobId: "j1", lang: "cs" },
    {
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.url = url;
        seen.init = init;
        return jsonResponse(200, { reasoning: { verdict: "v" }, source: "llm", cached: true, narrativeLang: "en" });
      }) as unknown as typeof fetch,
    },
  );
  assert.equal(out.status, "ok");
  assert.equal(seen.url, "/api/match/reasoning");
  assert.deepEqual(JSON.parse(String(seen.init?.body)), { profileId: "p1", jobId: "j1", lang: "cs" });
  if (out.status !== "ok") return;
  assert.equal(out.payload.source, "llm");
  assert.equal(out.payload.cached, true);
  // The field the popover needs to say "shown in English" — it was dropped entirely before.
  assert.equal(out.payload.narrativeLang, "en");
});

test("the request carries the caller's AbortSignal", async () => {
  const ac = new AbortController();
  let passed: AbortSignal | undefined;
  await fetchMatchReasoning(
    { profileId: "p", jobId: "j", lang: "en" },
    {
      signal: ac.signal,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        passed = init.signal ?? undefined;
        return jsonResponse(200, {});
      }) as unknown as typeof fetch,
    },
  );
  assert.equal(passed, ac.signal, "without the signal the spawn cannot be cancelled at all");
});

test("an abort resolves as 'aborted' — never as a failure the popover would render red", async () => {
  const ac = new AbortController();
  const out = await fetchMatchReasoning(
    { profileId: "p", jobId: "j", lang: "en" },
    {
      signal: ac.signal,
      fetchImpl: (async () => {
        ac.abort();
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        throw err;
      }) as unknown as typeof fetch,
    },
  );
  assert.equal(out.status, "aborted");
});

test("an abort that lands AFTER the response still resolves as 'aborted'", async () => {
  // The window between `await fetch` and `await r.json()`: the reader has already closed
  // the popover, so the answer must not be committed to state.
  const ac = new AbortController();
  const out = await fetchMatchReasoning(
    { profileId: "p", jobId: "j", lang: "en" },
    {
      signal: ac.signal,
      fetchImpl: (async () => {
        ac.abort();
        return jsonResponse(200, { reasoning: { verdict: "too late" } });
      }) as unknown as typeof fetch,
    },
  );
  assert.equal(out.status, "aborted");
});

test("a non-2xx resolves as 'failed' with the parsed body, so the CALLER resolves its code", async () => {
  const out = await fetchMatchReasoning(
    { profileId: "p", jobId: "j", lang: "en" },
    { fetchImpl: (async () => jsonResponse(503, { error: "boom", code: "E-LLM-1" })) as unknown as typeof fetch },
  );
  assert.equal(out.status, "failed");
  if (out.status !== "failed") return;
  assert.equal(out.body.code, "E-LLM-1", "the machine code must survive, never the English string");
});

test("a network throw is a failure, not an abort", async () => {
  const out = await fetchMatchReasoning(
    { profileId: "p", jobId: "j", lang: "en" },
    {
      fetchImpl: (async () => {
        throw new TypeError("network");
      }) as unknown as typeof fetch,
    },
  );
  assert.equal(out.status, "failed");
});

test("isAbortError recognizes both spellings and nothing else", () => {
  const dom = new Error("x");
  dom.name = "AbortError";
  assert.equal(isAbortError(dom), true);
  assert.equal(isAbortError(Object.assign(new Error("x"), { code: "ABORT_ERR" })), true);
  assert.equal(isAbortError(new TypeError("network")), false);
  assert.equal(isAbortError(null), false);
});
