// bug-ui-scan-2026-07-09 (model-api-key-management #3 + #5): pure UsagePanel fold.
//   #3 — Azure / unknown-model rows carry cost_usd NULL and sum to $0; foldByUseCase
//        must carry an `unpricedCalls` count so the panel can say "N unpriced" instead
//        of an authoritative-looking $0.00.
//   #5 — deterministic template fallbacks (provider="deterministic") must stay
//        distinguishable from real LLM calls in the collapsed "calls" metric.
// Runner: node --test with type stripping (no DOM, no JSX). `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { LlmUsageAggregateRow } from "@/app/_lib/db";
import { foldByUseCase, sumTotals } from "./spendUsageFold.ts";

// LlmUsageAggregateRow-shaped rows (day×provider×model rollups the route returns).
const row = (over: Partial<LlmUsageAggregateRow>): LlmUsageAggregateRow => ({
  day: "2026-07-09",
  useCase: "match_reasoning",
  provider: "anthropic",
  model: "claude-haiku-4-5",
  calls: 0,
  unpricedCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  costUsd: 0,
  ...over,
});

test("#3 foldByUseCase surfaces unpriced calls instead of hiding them behind $0", () => {
  const [fold] = foldByUseCase([
    row({ provider: "anthropic", calls: 10, unpricedCalls: 0, costUsd: 1.5 }),
    // Azure spend: real tokens, NULL cost → aggregate reports cost 0 + unpriced count.
    row({ provider: "azure_openai", calls: 4, unpricedCalls: 4, costUsd: 0, inputTokens: 8000 }),
  ]);
  assert.equal(fold.calls, 14);
  assert.equal(fold.costUsd, 1.5);
  assert.equal(fold.unpricedCalls, 4, "the 4 Azure calls are flagged unpriced, not silently $0");
});

test("#3 NON-VACUITY: with no unpriced field summed, the panel could not tell $0 from unknown", () => {
  // A use case whose ENTIRE spend is unpriced sums to costUsd 0 — identical to a
  // genuinely-free use case. unpricedCalls is the ONLY signal that separates them.
  const [fold] = foldByUseCase([row({ provider: "azure_openai", calls: 3, unpricedCalls: 3, costUsd: 0 })]);
  assert.equal(fold.costUsd, 0);
  assert.equal(fold.unpricedCalls, 3, "3 calls cost real money but priced as $0 — must read as unpriced");
});

test("#5 foldByUseCase separates deterministic fallbacks from real LLM calls", () => {
  const [fold] = foldByUseCase([
    row({ provider: "claude_cli", calls: 30, costUsd: 0.3 }),
    row({ provider: "deterministic", calls: 20, costUsd: 0 }),
  ]);
  assert.equal(fold.calls, 50, "headline count still totals every serve");
  assert.equal(fold.deterministicCalls, 20, "but the 20 template fallbacks stay distinguishable");
});

test("#5 a use case with only real LLM calls reports zero deterministic", () => {
  const [fold] = foldByUseCase([row({ provider: "anthropic", calls: 7, costUsd: 0.7 })]);
  assert.equal(fold.deterministicCalls, 0);
});

test("sumTotals rolls up calls, deterministic, unpriced and cost across use cases", () => {
  const totals = foldByUseCase([
    row({ useCase: "match_reasoning", provider: "anthropic", calls: 10, costUsd: 2 }),
    row({ useCase: "match_reasoning", provider: "deterministic", calls: 5, costUsd: 0 }),
    row({ useCase: "automation", provider: "azure_openai", calls: 4, unpricedCalls: 4, costUsd: 0 }),
  ]);
  const sum = sumTotals(totals);
  assert.equal(sum.calls, 19);
  assert.equal(sum.deterministicCalls, 5);
  assert.equal(sum.unpricedCalls, 4);
  assert.equal(sum.costUsd, 2);
});

test("foldByUseCase orders spendiest first, tie-broken by calls", () => {
  const totals = foldByUseCase([
    row({ useCase: "cheap", calls: 100, costUsd: 0.1 }),
    row({ useCase: "pricey", calls: 2, costUsd: 9 }),
  ]);
  assert.deepEqual(totals.map((t) => t.useCase), ["pricey", "cheap"]);
});
