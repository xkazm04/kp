// bug-ui-scan-2026-07-09 (model-api-key-management #3): Azure / unknown-model rows
// are written with cost_usd NULL (intentionally unpriced). aggregateLlmUsage folds
// them into cost 0 via COALESCE, so the usage panel showed real spend as $0.00 with
// no way to tell "cost $0" from "cost unknown". This pins the new `unpricedCalls`
// count the aggregate now exposes (SUM(cost_usd IS NULL)), which the panel renders
// as "N unpriced — see LightTrack".
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { cleanupUnitDb, UNIT_DB_DIR } from "../testing/unit-db.ts";
import { aggregateLlmUsage, ingestLlmUsageLog } from "./llm.ts";

after(() => {
  cleanupUnitDb();
});

// Two unpriced Azure calls (cost_usd null) + one priced Anthropic call — the exact
// mix the finding describes (BYOM Azure traffic invisibly summing to $0).
const AZURE_UNPRICED = JSON.stringify({
  use_case: "profile_draft",
  provider: "azure_openai",
  model: "my-gpt4o-deployment",
  input_tokens: 1200,
  output_tokens: 300,
  cached_tokens: null,
  cost_usd: null,
  source: "llm",
});
const PRICED = JSON.stringify({
  use_case: "profile_draft",
  provider: "anthropic",
  model: "claude-haiku-4-5",
  input_tokens: 100,
  output_tokens: 20,
  cached_tokens: null,
  cost_usd: 0.02,
  source: "llm",
});

test("#3 aggregateLlmUsage counts NULL-cost rows as unpriced instead of hiding them at $0", () => {
  const sidecar = path.join(UNIT_DB_DIR, "llm-usage-unpriced.ndjson");
  writeFileSync(sidecar, `${AZURE_UNPRICED}\n${AZURE_UNPRICED}\n${PRICED}\n`, "utf-8");
  assert.equal(ingestLlmUsageLog(sidecar), 3);

  const rows = aggregateLlmUsage().filter((r) => r.useCase === "profile_draft");
  const azure = rows.find((r) => r.provider === "azure_openai");
  const priced = rows.find((r) => r.provider === "anthropic");

  assert.ok(azure, "the Azure rollup exists");
  assert.equal(azure!.calls, 2);
  assert.equal(azure!.costUsd, 0, "unpriced rows still COALESCE to 0 cost");
  assert.equal(azure!.unpricedCalls, 2, "but both calls are flagged unpriced — real spend, unknown cost");
  assert.ok(azure!.inputTokens > 0, "and the tokens ARE metered (they weren't free)");

  assert.ok(priced, "the priced rollup exists");
  assert.equal(priced!.unpricedCalls, 0, "a row that carries a cost is never counted unpriced");
  assert.equal(priced!.costUsd, 0.02);
});
