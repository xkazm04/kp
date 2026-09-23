// Challenge r07 llm-layer/B: the Quality board's "Recommended routing" row joins
// the computed pick (llm-quality.ts recommendForUseCase) against what is pinned
// today (GET /api/llm/config rows) and yields the row state plus the exact PUT
// body the Pin button sends through saveRoutingPin - params pass through and the
// MODEL_ROUTING_STALE guard (expectedUpdatedAt) is kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { LlmConfigRow } from "../../../_lib/db/llm.ts";
import type { UseCaseRecommendation } from "../../../_lib/llm-quality.ts";
import { pickRowState, pinPayload, PICK_ROW_STATES } from "./modelsQualityPick.ts";

const PROVIDERS = ["claude_cli", "anthropic", "gemini", "openai", "qwen", "openrouter"];
const MEASURED = ["gemini-3.6-flash", "deepseek-v4-flash", "claude-sonnet-5", "claude-opus-5"];

const agg = (model: string, provider: string, composite: number, cost: number | null) => ({
  model,
  composite,
  costPerTaskUsd: cost,
  p50Ms: 10_000,
  judges: 4,
  llmRate: 1,
  target: { provider, model },
});

const REC: UseCaseRecommendation = {
  useCase: "match_reasoning",
  pick: agg("gemini-3.6-flash", "gemini", 9.0, 0.0036),
  best: agg("claude-opus-5", "claude_cli", 9.1, 0.2457),
  band: 0.15,
  reason: "cheapest_in_band",
  costMultiple: 68.3,
};

const row = (useCase: string, provider: string, model: string | null, over: Partial<LlmConfigRow> = {}): LlmConfigRow => ({
  useCase,
  provider,
  model,
  params: {},
  updatedAt: "2026-09-20T08:00:00.000Z",
  ...over,
});

const ctx = (over: Partial<{ measuredModels: readonly string[]; canPin: boolean | null }> = {}) => ({
  measuredModels: MEASURED,
  canPin: true as boolean | null,
  ...over,
});

test("the state vocabulary is closed", () => {
  assert.deepEqual(
    [...PICK_ROW_STATES],
    ["pinned", "pin_available", "unmeasured_pin", "pin_forbidden", "provider_unavailable"]
  );
});

test("pinned: the effective pin (own row, else '*') already names the pick's target", () => {
  const own = [row("match_reasoning", "gemini", "gemini-3.6-flash")];
  assert.equal(pickRowState("match_reasoning", REC, own, PROVIDERS, ctx()), "pinned");
  const inherited = [row("*", "gemini", "gemini-3.6-flash")];
  assert.equal(pickRowState("match_reasoning", REC, inherited, PROVIDERS, ctx()), "pinned");
  // same model on a DIFFERENT provider is not the measured target
  const other = [row("match_reasoning", "openrouter", "gemini-3.6-flash")];
  assert.equal(pickRowState("match_reasoning", REC, other, PROVIDERS, ctx()), "pin_available");
});

test("pin_available when the pin differs and the pick's provider is configured", () => {
  const rows = [row("match_reasoning", "claude_cli", "claude-opus-5")];
  assert.equal(pickRowState("match_reasoning", REC, rows, PROVIDERS, ctx()), "pin_available");
  // no pin at all (the built-in default) is also a pin the pick can replace
  assert.equal(pickRowState("match_reasoning", REC, [], PROVIDERS, ctx()), "pin_available");
});

test("unmeasured_pin when the current pin's model is not on the scorecard", () => {
  const rows = [row("match_reasoning", "openai", "gpt-5.4-mini")];
  assert.equal(pickRowState("match_reasoning", REC, rows, PROVIDERS, ctx()), "unmeasured_pin");
});

test("provider_unavailable when the pick's provider is not in the routing catalogue", () => {
  const rows = [row("match_reasoning", "claude_cli", "claude-opus-5")];
  assert.equal(
    pickRowState("match_reasoning", REC, rows, ["claude_cli", "openai"], ctx()),
    "provider_unavailable"
  );
});

test("pin_forbidden when the reader is known NOT to be a model admin; unknown fails open", () => {
  const rows = [row("match_reasoning", "claude_cli", "claude-opus-5")];
  assert.equal(pickRowState("match_reasoning", REC, rows, PROVIDERS, ctx({ canPin: false })), "pin_forbidden");
  assert.equal(pickRowState("match_reasoning", REC, rows, PROVIDERS, ctx({ canPin: null })), "pin_available");
  // an already-satisfied pick is 'pinned' whoever reads it
  const done = [row("match_reasoning", "gemini", "gemini-3.6-flash")];
  assert.equal(pickRowState("match_reasoning", REC, done, PROVIDERS, ctx({ canPin: false })), "pinned");
});

test("the pin payload: the pick's target, the own row's params, and the stale-write guard", () => {
  const own = row("match_reasoning", "claude_cli", "claude-opus-5", {
    params: { maxTokens: 900, timeoutS: 40 },
    updatedAt: "2026-09-21T10:00:00.000Z",
  });
  assert.deepEqual(pinPayload("match_reasoning", REC, [row("*", "anthropic", null), own]), {
    useCase: "match_reasoning",
    provider: "gemini",
    model: "gemini-3.6-flash",
    params: { maxTokens: 900, timeoutS: 40 },
    expectedUpdatedAt: "2026-09-21T10:00:00.000Z",
  });
  // No own row: the PUT creates one, so the guard is null ("I saw no pin") even
  // when a '*' catch-all exists - its updatedAt is not this use case's version.
  assert.deepEqual(pinPayload("match_reasoning", REC, [row("*", "anthropic", null)]), {
    useCase: "match_reasoning",
    provider: "gemini",
    model: "gemini-3.6-flash",
    params: {},
    expectedUpdatedAt: null,
  });
});
