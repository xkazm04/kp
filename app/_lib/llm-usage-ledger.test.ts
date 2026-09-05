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
    // A line written before the outcome/reason columns existed omits both keys, and
    // it recorded a call that SUCCEEDED — "ok" with nothing to explain is what it
    // meant, so that is what it maps to.
    outcome: "ok",
    reason: null,
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

// db/llm.ts aggregates this table with COALESCE(SUM(cost_usd), 0) and
// SUM(input_tokens) — the figures the Models usage panel shows and the pricing
// meters read. A negative row therefore SUBTRACTS from every total containing it,
// and the result is wrong in the direction nobody audits. Reachable without anyone
// writing a negative on purpose: cached-token discounts are computed by
// subtraction on the Python side, so a provider reporting more cached tokens than
// input tokens produces exactly this shape.
//
// Dropped to null rather than clamped to 0: the table already has a word for "we
// could not price this" — db/llm.ts counts `cost_usd IS NULL` as `unpriced_calls`
// — and landing there is visible, where landing in the sum is not.
test("negative tokens and negative cost are dropped, not summed into the ledger", () => {
  const row = parseLedgerLine(
    JSON.stringify({
      use_case: "match_reasoning",
      provider: "gemini",
      input_tokens: -5000,
      output_tokens: 120,
      cached_tokens: -1,
      cost_usd: -12.5,
    })
  );
  assert.ok(row);
  assert.equal(row.inputTokens, null, "a negative token count is unreadable, not a small one");
  assert.equal(row.cachedTokens, null);
  assert.equal(row.costUsd, null, "a negative cost belongs in unpriced_calls, never in SUM(cost_usd)");
  // NON-VACUITY: the valid field beside them still lands.
  assert.equal(row.outputTokens, 120);
  // Zero is a real, meaningful reading (a cached-only turn, a CLI call on a
  // subscription) and must survive the bound.
  const zero = parseLedgerLine(JSON.stringify({ use_case: "u", provider: "p", input_tokens: 0, cost_usd: 0 }));
  assert.equal(zero?.inputTokens, 0);
  assert.equal(zero?.costUsd, 0);
});

// input_tokens / output_tokens / cached_tokens are INTEGER columns (db/core.ts).
test("fractional token counts are rounded to the integer columns that hold them", () => {
  const row = parseLedgerLine(
    JSON.stringify({ use_case: "u", provider: "p", input_tokens: 1234.6, output_tokens: 0.4, cost_usd: 0.0125 })
  );
  assert.equal(row?.inputTokens, 1235);
  assert.equal(row?.outputTokens, 0);
  // Cost is a REAL column and genuinely fractional — it must NOT be rounded.
  assert.equal(row?.costUsd, 0.0125);
});

// ---- outcome / reason (tiger X2 + X14, 2026-09-05) --------------------------
// The degradation reason was computed by automation._generate and thrown away at
// this boundary (extra keys were ignored), and a failed attempt was never written
// at all. Both now ride the sidecar; see the visible-but-not-billable note in
// llm-usage-ledger.ts for why the failure gets its own column instead of a row in
// the sums.

test("a degraded serve's reason survives the line", () => {
  const row = parseLedgerLine(
    JSON.stringify({
      use_case: "campaign_pack",
      provider: "deterministic",
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      source: "deterministic",
      outcome: "ok",
      reason: "unusable_output",
    })
  );
  assert.equal(row?.reason, "unusable_output", "the WHY is the whole point of the row");
  assert.equal(row?.outcome, "ok", "a template serve is a meterable, truthful zero — not a failure");
});

test("a failed attempt parses as outcome 'failed' with no tokens to bill", () => {
  const row = parseLedgerLine(
    JSON.stringify({
      use_case: "cv_analysis",
      provider: "gemini",
      model: "gemini-2.5-flash",
      input_tokens: null,
      output_tokens: null,
      cost_usd: null,
      source: "llm",
      outcome: "failed",
      reason: "provider_timeout",
    })
  );
  assert.equal(row?.outcome, "failed");
  assert.equal(row?.reason, "provider_timeout");
  assert.equal(row?.costUsd, null, "the provider reported no usage; a guess here would be billed");
});

test("a line with no outcome key is 'ok' — every row written before the column existed was one", () => {
  const row = parseLedgerLine(JSON.stringify({ use_case: "x", provider: "p", cost_usd: 0.5 }));
  assert.equal(row?.outcome, "ok");
  assert.equal(row?.reason, null);
});

// The inverse of the `source` coercion above, and deliberately so: `source` names
// whose words are on the wire and a garbled value can safely fall back to "llm",
// but `outcome` decides whether the row's money joins a total. An unclassifiable
// value there has no safe default in either direction, so the LINE goes.
test("an unrecognized outcome drops the whole line rather than guessing it into a total", () => {
  assert.equal(parseLedgerLine(JSON.stringify({ use_case: "x", provider: "p", outcome: "maybe" })), null);
  assert.equal(parseLedgerLine(JSON.stringify({ use_case: "x", provider: "p", outcome: 7 })), null);
});

// `reason` is a durable, operator-facing column and a provider's message can echo
// the prompt back. Python reduces prose to a code before writing (monitor._reason_code);
// this is the boundary re-asserting it, so one forgetful producer cannot land prose.
test("reason accepts only a snake_case code — prose is dropped to null", () => {
  const codeOf = (reason: unknown) =>
    parseLedgerLine(JSON.stringify({ use_case: "x", provider: "p", reason }))?.reason;
  assert.equal(codeOf("provider_timeout"), "provider_timeout");
  assert.equal(codeOf("offline_policy"), "offline_policy");
  assert.equal(codeOf("LLMError: gemini call failed: the prompt was ..."), null);
  assert.equal(codeOf("Provider Timeout"), null, "spaces and capitals are prose, not a code");
  assert.equal(codeOf("a".repeat(65)), null, "bounded — a column is not a log line");
  assert.equal(codeOf(42), null);
  assert.equal(codeOf(undefined), null);
});
