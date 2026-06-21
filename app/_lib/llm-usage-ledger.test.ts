import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLedgerLine } from "./llm-usage-ledger.ts";

// T0.1: the branchy half of ledger ingestion — parsing/validating one sidecar
// NDJSON line. Kept pure (no DB) so it runs under `node --test`; db/llm.ts wraps
// this with the file read + INSERT, which typecheck + the git-faithful restore cover.

test("maps a full valid line to the insertLlmUsage shape", () => {
  const row = parseLedgerLine(
    JSON.stringify({
      use_case: "match_reasoning",
      provider: "anthropic",
      model: "claude-haiku-4-5",
      input_tokens: 100,
      output_tokens: 20,
      cached_tokens: 5,
      cost_usd: 0.0002,
      source: "llm",
    })
  );
  assert.deepEqual(row, {
    useCase: "match_reasoning",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    inputTokens: 100,
    outputTokens: 20,
    cachedTokens: 5,
    costUsd: 0.0002,
    source: "llm",
    requestId: null,
  });
});

test("keeps a CLI line with null model and null cost (claude_cli default)", () => {
  const row = parseLedgerLine(
    JSON.stringify({ use_case: "automation", provider: "claude_cli", model: null, cost_usd: null, source: "llm" })
  );
  assert.ok(row);
  assert.equal(row!.provider, "claude_cli");
  assert.equal(row!.model, null);
  assert.equal(row!.costUsd, null);
});

test("drops a line missing a NOT NULL column (use_case / provider)", () => {
  assert.equal(parseLedgerLine(JSON.stringify({ provider: "anthropic" })), null);
  assert.equal(parseLedgerLine(JSON.stringify({ use_case: "automation" })), null);
});

test("drops non-JSON, empty, and non-object lines instead of throwing", () => {
  assert.equal(parseLedgerLine("not json at all"), null);
  assert.equal(parseLedgerLine("   "), null);
  assert.equal(parseLedgerLine("42"), null);
  assert.equal(parseLedgerLine("null"), null);
  assert.equal(parseLedgerLine('["array"]'), null);
});

test("coerces source: anything but explicit 'deterministic' becomes 'llm'", () => {
  assert.equal(parseLedgerLine(JSON.stringify({ use_case: "x", provider: "p" }))!.source, "llm");
  assert.equal(
    parseLedgerLine(JSON.stringify({ use_case: "x", provider: "p", source: "deterministic" }))!.source,
    "deterministic"
  );
  assert.equal(
    parseLedgerLine(JSON.stringify({ use_case: "x", provider: "p", source: "garbage" }))!.source,
    "llm"
  );
});

test("non-finite / wrong-typed token counts coerce to null (not NaN)", () => {
  const row = parseLedgerLine(
    JSON.stringify({ use_case: "x", provider: "p", input_tokens: "oops", output_tokens: null })
  );
  assert.ok(row);
  assert.equal(row!.inputTokens, null);
  assert.equal(row!.outputTokens, null);
});
