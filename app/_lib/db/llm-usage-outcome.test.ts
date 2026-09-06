// tiger X2 + X14 (2026-09-05) — the two facts the ledger computed and then lost.
//
// X14: `automation._generate` classifies every descent ("provider_timeout",
// "unusable_output", …) and its docstring says why — until the reason reached a
// COLUMN, the ledger could not tell a keyless install from a provider that answered
// with prose, and the operator saw the same zero-cost line for both. The reason went
// as far as the sidecar and no further.
//
// X2: `monitor.emit_error` returned early whenever LightTrack was absent — the
// default deployment — so a call that timed out AFTER sending a large prompt, the
// most expensive attempt this app makes, appeared in `llm_usage` nowhere at all.
//
// The tension the fix had to resolve: a failed attempt cost money, but this table's
// honesty property is that a row in it is a call that can be SUMMED, and a dead call
// reports no usage to sum. So the failure gets `outcome`, a named bucket beside the
// totals rather than inside them — the same move `unpriced_calls` already makes for
// a row that cannot be PRICED. This file pins the half that matters: it is visible,
// and it is in none of the money.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { cleanupUnitDb, UNIT_DB_DIR } from "../testing/unit-db.ts";
import { aggregateLlmUsage, ingestLlmUsageLog, listLlmActivity } from "./llm.ts";
import { computeCostWindow } from "./analytics.ts";

after(() => {
  cleanupUnitDb();
});

const USE_CASE = "outcome_probe";

// Byte-for-byte the three shapes monitor.py now writes for this use case.
const OK_PRICED = JSON.stringify({
  use_case: USE_CASE,
  provider: "gemini",
  model: "gemini-2.5-flash",
  input_tokens: 1000,
  output_tokens: 200,
  cached_tokens: null,
  cost_usd: 0.05,
  source: "llm",
  outcome: "ok",
});
const DEGRADED = JSON.stringify({
  use_case: USE_CASE,
  provider: "deterministic",
  model: null,
  input_tokens: 0,
  output_tokens: 0,
  cached_tokens: null,
  cost_usd: 0,
  source: "deterministic",
  outcome: "ok",
  reason: "unusable_output",
});
const FAILED = JSON.stringify({
  use_case: USE_CASE,
  provider: "gemini",
  model: "gemini-2.5-flash",
  input_tokens: null,
  output_tokens: null,
  cached_tokens: null,
  cost_usd: null,
  source: "llm",
  outcome: "failed",
  reason: "provider_timeout",
});

function ingest(name: string, lines: string[]): number {
  const sidecar = path.join(UNIT_DB_DIR, name);
  writeFileSync(sidecar, `${lines.join("\n")}\n`, "utf-8");
  return ingestLlmUsageLog(sidecar);
}

test("X14: a degraded serve's reason reaches the row and survives a read-back", () => {
  assert.equal(ingest("outcome-degraded.ndjson", [DEGRADED]), 1);
  const row = listLlmActivity().find((r) => r.useCase === USE_CASE && r.provider === "deterministic");
  assert.ok(row, "the deterministic serve is in the ledger");
  assert.equal(row!.reason, "unusable_output", "WHY the template served, not just that it did");
  assert.equal(row!.outcome, "ok", "it served — a truthful zero, not a failure");
});

test("X2: a failed attempt is visible in the row-level ledger", () => {
  assert.equal(ingest("outcome-failed.ndjson", [FAILED]), 1);
  const row = listLlmActivity().find((r) => r.useCase === USE_CASE && r.outcome === "failed");
  assert.ok(row, "the timed-out call is no longer invisible on a deployment without LightTrack");
  assert.equal(row!.reason, "provider_timeout");
  assert.equal(row!.costUsd, null, "unknown, stated as unknown — never an estimate in a billed column");
});

test("a failed attempt is in NONE of the billable aggregates, and IS in the failure count", () => {
  assert.equal(ingest("outcome-mix.ndjson", [OK_PRICED, FAILED, FAILED]), 3);

  // aggregateLlmUsage — the Models usage panel and the pricing meters.
  const rows = aggregateLlmUsage().filter((r) => r.useCase === USE_CASE && r.provider === "gemini");
  assert.equal(rows.length, 1, "one (day × use_case × provider × model) bucket holds both classes");
  const g = rows[0]!;
  assert.equal(g.calls, 1, "the two failures are not calls that happened for billing purposes");
  assert.equal(g.failedCalls, 3, "…but they ARE counted — 2 here plus the one the test above ingested");
  assert.equal(g.costUsd, 0.05, "SUM(cost_usd) sees only the attempt that answered");
  assert.equal(g.inputTokens, 1000, "SUM(input_tokens) likewise");
  assert.equal(g.outputTokens, 200);
  assert.equal(
    g.unpricedCalls,
    0,
    "a failed row carries NULL cost by construction; folding it into unpriced_calls would " +
      "confuse 'we cannot price this call' with 'the call died'"
  );

  // computeCostWindow — the cost-per-hire numerator (analytics.ts).
  const all = computeCostWindow(null);
  assert.ok(all.costUsd > 0, "non-vacuity: the priced row IS being summed somewhere");
  assert.equal(all.calls, 2, "the two ok rows (priced + the degraded serve), never the three failures");
  assert.equal(all.unpricedCalls, 0, "and no failure leaked into the unpriced bucket either");
});

test("a bucket of nothing but failures reports zero cost and a non-zero failure count", () => {
  // The question this whole design exists to answer: "why did this use case cost
  // nothing this morning?" Before X2 the ledger's answer and "nobody used it" were
  // the same silence.
  assert.equal(ingest("outcome-only-failed.ndjson", [FAILED.replace(USE_CASE, "all_failed")]), 1);
  const row = aggregateLlmUsage().find((r) => r.useCase === "all_failed");
  assert.ok(row, "the bucket EXISTS — it is not filtered away as an empty row");
  assert.equal(row!.calls, 0);
  assert.equal(row!.costUsd, 0);
  assert.equal(row!.failedCalls, 1);
});
