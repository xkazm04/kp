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
import { aggregateLlmUsage, ingestLlmUsageLog, ingestLlmUsageResult, listLlmActivity } from "./llm.ts";

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

// IDEMPOTENCY. The fold used to be idempotent only by accident: the sidecar is
// deleted afterwards, so nothing could be read twice — except that the delete is
// a best-effort `rmSync` inside a catch, and a Windows lock / read-only temp dir
// / crash between the INSERT and the unlink leaves the file exactly where the
// next ingest of the same path will find it. With no key to refuse on, every one
// of those rows landed a SECOND time and the spend the pricing meters read was
// silently double what the deployment actually spent. The per-line `ingest_key`
// (a unique index in core.ts) makes the second fold a no-op instead.
test("a second ingest of the same sidecar adds nothing and reports the duplicates it skipped", () => {
  const sidecar = path.join(UNIT_DB_DIR, "llm-usage-replay.ndjson");
  const line = (n: number) =>
    JSON.stringify({
      use_case: "replay_probe",
      provider: "claude_cli",
      model: null,
      input_tokens: n,
      output_tokens: n,
      cached_tokens: null,
      cost_usd: 0.01,
      source: "llm",
      request_id: "t_replay_run",
    });
  // Two lines sharing ONE request_id — the real shape of a spawn that made two
  // metered calls. Whatever refuses a replay must NOT refuse these, so the key
  // cannot be request_id itself.
  const body = `${line(1)}\n${line(2)}\n`;
  writeFileSync(sidecar, body, "utf-8");
  assert.equal(ingestLlmUsageLog(sidecar), 2, "both calls of the spawn fold in");

  const after = () => listLlmActivity().filter((r) => r.useCase === "replay_probe");
  assert.equal(after().length, 2, "one row per metered call, not one per request_id");

  // The sidecar the failed cleanup left behind, re-read.
  writeFileSync(sidecar, body, "utf-8");
  const result = ingestLlmUsageResult(sidecar);
  assert.equal(result.inserted, 0, "a replay of the same sidecar inserts nothing");
  assert.equal(result.skipped, 2, "and SAYS how many duplicate lines it refused");
  assert.equal(after().length, 2, "the ledger is unchanged — spend is not doubled");
});
