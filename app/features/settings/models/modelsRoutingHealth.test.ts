// PINNED IS NOT SERVING. The Models > Routing table used to report configuration
// only: a Pinned/Default badge and the pin's date. The usage ledger already knows,
// per call, which provider answered, whether the template floor served instead and
// why, and whether the call failed. This pins the pure classifier that turns one
// use case's ledger read (db/llm-routing-health.ts `routingHealth`, already cut at the pin's
// `updatedAt`) into the state a row shows and the one repair it calls for.
//
// Case 4 is the one that catches the likely wrong build: a re-pin must not be
// credited with its predecessor's traffic. The cut happens in the store; the
// classifier's half is that "pinned + nothing since" is UNPROVEN, not idle and
// never serving.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RoutingHealthRow } from "../../../_lib/db/llm-routing-health.ts";
import {
  classifyRoutingHealth,
  effectivePin,
  withModelSection,
  ROUTING_HEALTH_STATES,
} from "./modelsRoutingHealth.ts";

const T0 = "2026-09-20T08:00:00.000Z";

function health(partial: Partial<RoutingHealthRow> & Pick<RoutingHealthRow, "last">): RoutingHealthRow {
  return {
    useCase: "match_reasoning",
    since: T0,
    llmOk: 0,
    deterministic: 0,
    failed: 0,
    lastServed: null,
    ...partial,
  };
}

const pin = (provider: string, updatedAt = T0) => ({ provider, updatedAt });
// The routing catalogue as GET /api/llm/config ships it (LLM_PROVIDERS).
const PROVIDERS = ["anthropic", "openai", "azure_openai", "gemini", "openrouter", "qwen", "ollama", "gateway", "claude_cli"];

test("1 serving: pinned to gemini, three ok llm rows since the pin", () => {
  const h = health({
    llmOk: 3,
    last: { at: "2026-09-21T10:00:00.000Z", provider: "gemini", model: "m", source: "llm", outcome: "ok", reason: null },
    lastServed: { at: "2026-09-21T10:00:00.000Z", provider: "gemini", model: "m" },
  });
  const r = classifyRoutingHealth(pin("gemini"), h, PROVIDERS);
  assert.equal(r.state, "serving");
  assert.deepEqual(r.served, { provider: "gemini", model: "m" });
  assert.equal(r.lastAt, "2026-09-21T10:00:00.000Z");
  assert.equal(r.repair, "none");
});

test("2 falling_back: only deterministic rows (missing_key) since the pin -> repair keys", () => {
  const h = health({
    deterministic: 2,
    last: { at: "2026-09-21T10:00:00.000Z", provider: "deterministic", model: null, source: "deterministic", outcome: "ok", reason: "missing_key" },
  });
  const r = classifyRoutingHealth(pin("gemini"), h, PROVIDERS);
  assert.equal(r.state, "falling_back");
  assert.equal(r.reason, "missing_key");
  assert.equal(r.repair, "keys");
  assert.equal(r.served, null, "a template serve is not a provider serve");
  assert.equal(withModelSection("http://localhost/?tab=models&modelSec=routing", "keys"), "/?tab=models&modelSec=keys");
});

test("3 failing: the newest row since the pin failed (provider_timeout) after earlier ok rows -> repair test", () => {
  const h = health({
    llmOk: 4,
    failed: 1,
    last: { at: "2026-09-21T11:00:00.000Z", provider: "gemini", model: "m", source: "llm", outcome: "failed", reason: "provider_timeout" },
    lastServed: { at: "2026-09-21T10:00:00.000Z", provider: "gemini", model: "m" },
  });
  const r = classifyRoutingHealth(pin("gemini"), h, PROVIDERS);
  assert.equal(r.state, "failing");
  assert.equal(r.reason, "provider_timeout");
  assert.equal(r.repair, "test");
});

test("4 unproven: pinned, and no ledger traffic since the pin (the store cut the older rows off)", () => {
  // The store returns NO row for a use case whose only traffic predates the pin.
  const r = classifyRoutingHealth(pin("openai"), undefined, PROVIDERS);
  assert.equal(r.state, "unproven");
  assert.equal(r.served, null, "the old provider's success is not credited to the new pin");
  assert.equal(r.repair, "test");
});

test("4b a health read cut before the CURRENT pin (re-pinned in place, not re-fetched) is not credited", () => {
  const h = health({
    since: T0,
    llmOk: 5,
    last: { at: "2026-09-21T10:00:00.000Z", provider: "claude_cli", model: null, source: "llm", outcome: "ok", reason: null },
    lastServed: { at: "2026-09-21T10:00:00.000Z", provider: "claude_cli", model: null },
  });
  const r = classifyRoutingHealth(pin("gemini", "2026-09-22T09:00:00.000Z"), h, PROVIDERS);
  assert.equal(r.state, "unproven");
});

test("5 drift: pinned to openai, but claude_cli answered since the pin", () => {
  const h = health({
    llmOk: 2,
    last: { at: "2026-09-21T10:00:00.000Z", provider: "claude_cli", model: null, source: "llm", outcome: "ok", reason: null },
    lastServed: { at: "2026-09-21T10:00:00.000Z", provider: "claude_cli", model: null },
  });
  const r = classifyRoutingHealth(pin("openai"), h, PROVIDERS);
  assert.equal(r.state, "drift");
  assert.deepEqual(r.served, { provider: "claude_cli", model: null });
  assert.equal(r.repair, "test");
});

test("6 unpinned: serving names what Default resolved to; no rows -> idle", () => {
  const h = health({
    llmOk: 1,
    last: { at: "2026-09-21T10:00:00.000Z", provider: "gemini", model: "flash", source: "llm", outcome: "ok", reason: null },
    lastServed: { at: "2026-09-21T10:00:00.000Z", provider: "gemini", model: "flash" },
  });
  const served = classifyRoutingHealth(null, h, PROVIDERS);
  assert.equal(served.state, "serving");
  assert.equal(served.served?.provider, "gemini");
  const idle = classifyRoutingHealth(null, undefined, PROVIDERS);
  assert.equal(idle.state, "idle");
  assert.equal(idle.repair, "none");
});

test("the catch-all '*' pin is the effective pin of an unpinned use case", () => {
  const rows = [
    { useCase: "*", provider: "openai", model: null, params: {}, updatedAt: T0 },
    { useCase: "automation", provider: "gemini", model: null, params: {}, updatedAt: T0 },
  ];
  assert.equal(effectivePin("automation", rows)?.provider, "gemini", "an own pin wins");
  assert.equal(effectivePin("match_reasoning", rows)?.provider, "openai", "otherwise the '*' pin");
  assert.equal(effectivePin("match_reasoning", [rows[1]]), null);
});

test("a served provider outside the routing catalog (a TS-direct voice writer) is never called drift", () => {
  const h = health({
    llmOk: 1,
    last: { at: "2026-09-21T10:00:00.000Z", provider: "elevenlabs", model: null, source: "llm", outcome: "ok", reason: null },
    lastServed: { at: "2026-09-21T10:00:00.000Z", provider: "elevenlabs", model: null },
  });
  assert.equal(classifyRoutingHealth(pin("openai"), h, PROVIDERS).state, "serving");
});

test("a policy descent (offline seal) falls back with no repair button to press", () => {
  const h = health({
    deterministic: 1,
    last: { at: "2026-09-21T10:00:00.000Z", provider: "deterministic", model: null, source: "deterministic", outcome: "ok", reason: "offline_policy" },
  });
  const r = classifyRoutingHealth(null, h, PROVIDERS);
  assert.equal(r.state, "falling_back");
  assert.equal(r.repair, "none");
  assert.deepEqual([...ROUTING_HEALTH_STATES], ["serving", "falling_back", "failing", "drift", "unproven", "idle"]);
});
