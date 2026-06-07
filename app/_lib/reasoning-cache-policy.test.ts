// Pins the per-match reasoning cache-invalidation contract (idea-4d3bf96f):
// only an authoritative LLM verdict may be frozen in the 168h prompt cache. A
// deterministic-template fallback — emitted when the LLM provider is down — must
// NOT be cached, or a recruiter would be served a low-quality rationale for a
// week with no way to upgrade once the provider returns.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { isCacheableReasoning, CACHEABLE_REASONING_SOURCE } from "./reasoning-cache-policy.ts";

test("an llm-sourced verdict is cacheable", () => {
  assert.equal(isCacheableReasoning({ source: "llm", reasoning: {} }), true);
});

test("a deterministic fallback is NOT cacheable (the staleness trap)", () => {
  assert.equal(isCacheableReasoning({ source: "deterministic", reasoning: {} }), false);
});

test("an unknown / missing source is treated as non-cacheable (fail closed)", () => {
  assert.equal(isCacheableReasoning({ reasoning: {} }), false);
  assert.equal(isCacheableReasoning({ source: "gemini" }), false);
  assert.equal(isCacheableReasoning({ source: "" }), false);
});

test("non-object payloads never cache", () => {
  assert.equal(isCacheableReasoning(null), false);
  assert.equal(isCacheableReasoning(undefined), false);
  assert.equal(isCacheableReasoning("llm"), false);
  assert.equal(isCacheableReasoning(42), false);
});

test("the cacheable source is the LLM tag emitted by reasoning_cli", () => {
  // Guards against the constant drifting away from reasoning_cli's source values
  // ('llm' | 'deterministic'); only the authoritative one is cacheable.
  assert.equal(CACHEABLE_REASONING_SOURCE, "llm");
});
