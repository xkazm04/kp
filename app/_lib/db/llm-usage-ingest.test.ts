// Behavioral test for the sidecar → ledger fold (backlog item 22): Python's
// monitor now emits source:"deterministic" lines when a CLI's template
// fallback serves (keyless --no-llm / provider-unavailable / failed call), and
// this pins the TS half of that contract end-to-end — ingestLlmUsageLog folds
// the line into llm_usage, and aggregateLlmUsage exposes it as its own
// "deterministic" provider row (zero tokens, zero cost) beside real LLM spend.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the
// first project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cleanupUnitDb, UNIT_DB_DIR } from "../testing/unit-db.ts";
import { aggregateLlmUsage, ingestLlmUsageLog } from "./llm.ts";

after(() => {
  cleanupUnitDb();
});

// Byte-for-byte the shapes monitor.py writes: emit_result (llm) and
// emit_deterministic (the fallback line — zero tokens/cost, provider
// "deterministic").
const LLM_LINE = JSON.stringify({
  use_case: "campaign_pack",
  provider: "claude_cli",
  model: null,
  input_tokens: 200,
  output_tokens: 40,
  cached_tokens: null,
  cost_usd: 0.012,
  source: "llm",
});
const DETERMINISTIC_LINE = JSON.stringify({
  use_case: "campaign_pack",
  provider: "deterministic",
  model: null,
  input_tokens: 0,
  output_tokens: 0,
  cached_tokens: null,
  cost_usd: 0.0,
  source: "deterministic",
});

test("ingest folds a deterministic fallback line and the aggregate exposes it as its own provider row", () => {
  const sidecar = path.join(UNIT_DB_DIR, "llm-usage.ndjson");
  writeFileSync(sidecar, `${LLM_LINE}\n${DETERMINISTIC_LINE}\n`, "utf-8");

  assert.equal(ingestLlmUsageLog(sidecar), 2, "both the llm and the deterministic line must fold in");
  assert.equal(existsSync(sidecar), false, "the per-spawn sidecar is deleted after the fold");

  const rows = aggregateLlmUsage().filter((r) => r.useCase === "campaign_pack");
  const deterministic = rows.find((r) => r.provider === "deterministic");
  const llm = rows.find((r) => r.provider === "claude_cli");

  // The provider grouping keeps template serves distinguishable from real spend.
  assert.ok(deterministic, "the deterministic serve appears as its own provider row");
  assert.equal(deterministic!.calls, 1);
  assert.equal(deterministic!.inputTokens, 0);
  assert.equal(deterministic!.outputTokens, 0);
  assert.equal(deterministic!.costUsd, 0, "a template serve carries zero cost");

  assert.ok(llm, "the real LLM call still aggregates beside it");
  assert.equal(llm!.costUsd, 0.012);
});
