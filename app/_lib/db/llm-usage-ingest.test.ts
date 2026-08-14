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
import { aggregateLlmUsage, ingestLlmUsageLog, listLlmActivity } from "./llm.ts";

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

// The middle link of the Activity row-detail chain. The two ends are pinned
// elsewhere — the TS scope → child env in llm-request-context.test.ts, the child
// env → ledger line in test_llm_monitor.py — but a request_id dropped between
// the sidecar and listLlmActivity would break the feature with every other test
// still green: the rows would simply keep the nulls they had for their whole
// life, which is also the legitimate unlinked case and so reads as normal.
test("a sidecar line's request_id survives the fold and reaches the activity row", () => {
  const sidecar = path.join(UNIT_DB_DIR, "llm-usage-request-id.ndjson");
  const LINKED = JSON.stringify({
    use_case: "jd_build",
    provider: "claude_cli",
    model: "claude-cli-default",
    input_tokens: 10,
    output_tokens: 5,
    cached_tokens: null,
    cost_usd: 0.001,
    source: "llm",
    request_id: "t_linked_run",
  });
  // Same shape minus the key — a spawn outside any tracked run.
  const UNLINKED = JSON.stringify({
    use_case: "jd_build",
    provider: "claude_cli",
    model: "claude-cli-default",
    input_tokens: 10,
    output_tokens: 5,
    cached_tokens: null,
    cost_usd: 0.001,
    source: "llm",
    request_id: null,
  });
  writeFileSync(sidecar, `${LINKED}\n${UNLINKED}\n`, "utf-8");
  assert.equal(ingestLlmUsageLog(sidecar), 2);

  const rows = listLlmActivity().filter((r) => r.useCase === "jd_build");
  assert.equal(rows.length, 2);
  assert.equal(
    rows.filter((r) => r.requestId === "t_linked_run").length,
    1,
    "the linked row carries the task id the detail fetches its output with"
  );
  assert.equal(
    rows.filter((r) => r.requestId === null).length,
    1,
    "the unlinked row stays null — it must not inherit a sibling's run"
  );
});
