// The TS half of the LightTrack seam must emit the SAME event shape as the
// Python half (pipeline/jobfit/llm/monitor.py), because both land in one pane of
// glass and are sliced by the same queries. The trap this pins: LightTrack's
// `operation` is a fixed enum with a serde catch-all (`Operation` in
// ../tracklight crates/core/src/event.rs), so a free-form use case does NOT
// fail — it silently becomes "other". A regression here is therefore invisible
// at runtime and only shows up as a use case that has no traffic.
//
// No network: `fetch` is stubbed, and the emitter is fire-and-forget so the
// captured body is inspected synchronously after the call returns.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { trackLlmToLightTrack, reasonCode } from "./llm-lighttrack.ts";

type Capture = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

const realFetch = globalThis.fetch;
let calls: Capture[] = [];

beforeEach(() => {
  calls = [];
  process.env.LIGHTTRACK_URL = "http://127.0.0.1:8787";
  delete process.env.LIGHTTRACK_PROJECT;
  delete process.env.LIGHTTRACK_KEY;
  globalThis.fetch = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
    return { ok: true } as unknown as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.LIGHTTRACK_URL;
});

const track = (over: Partial<Parameters<typeof trackLlmToLightTrack>[0]> = {}) => {
  calls = [];
  trackLlmToLightTrack({
    provider: "gemini",
    model: "gemini-3.6-flash",
    useCase: "github_analysis",
    inputTokens: 1200,
    outputTokens: 300,
    costUsd: 0.0039,
    latencyMs: 4210,
    ...over,
  });
  assert.equal(calls.length, 1, "expected exactly one POST");
  return calls[0];
};

test("operation is the enum value 'chat', never the use case", () => {
  // A free-form operation deserializes to "other" server-side, so every
  // TS-direct call would land in one anonymous bucket while the Python-metered
  // calls read "chat" — the two halves of the same layer, unjoinable.
  assert.equal(track().body.operation, "chat");
});

test("the use case rides on a use_case: tag (the queryable axis), beside tool:", () => {
  const tags = track().body.tags as string[];
  assert.ok(tags.includes("use_case:github_analysis"), `missing use_case tag: ${tags.join(",")}`);
  assert.ok(tags.includes("tool:github_analysis"), `missing tool tag: ${tags.join(",")}`);
  assert.ok(tags.includes("llm-layer") && tags.includes("runtime:ts"));
});

test("name is populated from the use case (LightTrack's use-case registry field)", () => {
  assert.equal(track({ useCase: "github_analysis" }).body.name, "github_analysis");
});

test("name is absent when there is no use case", () => {
  const body = track({ useCase: undefined }).body;
  assert.equal(body.name, undefined);
  assert.ok(!("name" in body));
});

test("provider alias folds gemini into google so TS traffic groups with Python's", () => {
  const body = track().body;
  assert.equal(body.provider, "google");
  assert.equal(body.source, "kp");
  assert.deepEqual(body.usage, { input: 1200, output: 300 });
  assert.deepEqual(body.metadata, { cost_usd: 0.0039 });
  assert.equal(body.latency_ms, 4210);
  assert.equal(calls[0].url, "http://127.0.0.1:8787/v1/events");
});

test("a zero cost is still reported (0 is a fact, not a missing value)", () => {
  assert.deepEqual(track({ costUsd: 0 }).body.metadata, { cost_usd: 0 });
});

test("cached tokens ride as cached_input; null/absent omits the field", () => {
  assert.deepEqual(track({ cachedTokens: 900 }).body.usage, { input: 1200, output: 300, cached_input: 900 });
  assert.deepEqual(track({ cachedTokens: null }).body.usage, { input: 1200, output: 300 });
});

/* CHANGED DELIBERATELY. This used to assert that an error was truncated to 500
 * characters — i.e. that up to 500 bytes of provider-authored text left the
 * process. A provider message can echo the prompt, and on this product a prompt
 * carries a candidate's CV, so a bounded message is still the wrong shape: this
 * repo answers a failure with a CODE, never with the thrown message. The Python
 * half already refused it (`monitor._reason_code` collapses a prose line to
 * `provider_error` before it reaches a durable column) and this half did not, so
 * the discipline held on one runtime out of two. */

test("an error emits status:error carrying a code, never a message", () => {
  const body = track({ error: "provider_timeout" }).body;
  assert.equal(body.status, "error");
  assert.equal(body.error, "provider_timeout", "a bare code passes through unchanged");
});

test("provider prose never leaves the process", () => {
  // The realistic leak: a provider echoes the prompt back inside its error text.
  const leak = 'Error: invalid request — content was "Jan Novak, jan@example.com, 10 years at ..."';
  const body = track({ error: leak }).body;
  assert.equal(body.error, "provider_error", "anything that is not a code collapses to the catch-all");
  assert.doesNotMatch(String(body.error), /Novak|example\.com/, "no candidate text may survive");
});

test("the type half of a thrown error is kept when it names a distinct descent", () => {
  // "<Type>: <message>" — the type is ours, the message is the provider's. Keeping
  // the few types that mean something stops a timeout flattening into the catch-all
  // without ever storing the message half.
  assert.equal(reasonCode("TimeoutError: upstream took too long"), "provider_timeout");
  assert.equal(reasonCode("AbortError: signal aborted"), "provider_timeout");
  assert.equal(reasonCode("SomethingElse: with detail"), "provider_error");
  assert.equal(reasonCode("  "), null, "an empty reason is not a failure");
  assert.equal(reasonCode(undefined), null);
});

test("no LIGHTTRACK_URL is a hard no-op (the default deployment)", () => {
  delete process.env.LIGHTTRACK_URL;
  trackLlmToLightTrack({ provider: "gemini", useCase: "github_analysis", inputTokens: 5 });
  assert.equal(calls.length, 0);
});

test("a throwing fetch never escapes — telemetry cannot break the host call", () => {
  globalThis.fetch = (() => {
    throw new Error("connect ECONNREFUSED");
  }) as unknown as typeof fetch;
  assert.doesNotThrow(() => trackLlmToLightTrack({ provider: "gemini", useCase: "github_analysis" }));
});
