import { test } from "node:test";
import assert from "node:assert/strict";
import { TTS_KCHAR_PRICES, ttsCostUsd, ttsUsageRow } from "./tts-prices.ts";

test("a cloud synthesis is priced per character, rounded to 6 decimals", () => {
  assert.equal(ttsCostUsd("elevenlabs", 1000), TTS_KCHAR_PRICES.elevenlabs);
  assert.equal(ttsCostUsd("elevenlabs", 280), Math.round(0.22 * 0.28 * 1e6) / 1e6);
});

test("a local engine costs a KNOWN zero", () => {
  assert.equal(ttsCostUsd("piper", 4000), 0);
  assert.equal(ttsCostUsd("kokoro", 4000), 0);
});

test("an unpriced provider is UNKNOWN cost, never zero", () => {
  assert.equal(ttsCostUsd("some-new-engine", 1000), null);
  assert.equal(ttsCostUsd("", 1000), null);
});

test("a nonsense character count is unknown cost rather than a fabricated one", () => {
  assert.equal(ttsCostUsd("elevenlabs", -1), null);
  assert.equal(ttsCostUsd("elevenlabs", Number.NaN), null);
});

test("a synthesis ledger row carries provider, voice and cost — and no token counts", () => {
  const row = ttsUsageRow({ provider: "elevenlabs", voiceId: "rachel", chars: 1000, cached: false, requestId: "k" });
  assert.equal(row.useCase, "tts");
  assert.equal(row.provider, "elevenlabs");
  assert.equal(row.model, "rachel");
  assert.equal(row.source, "llm");
  assert.equal(row.costUsd, 0.22);
  assert.equal(row.requestId, "k");
  // Characters are not tokens: aggregateLlmUsage sums these columns across
  // every use case, so a character count here would be two units in one sum.
  assert.equal(row.inputTokens, null);
  assert.equal(row.outputTokens, null);
  assert.equal(row.cachedTokens, null);
});

test("an unpriced provider still gets a counted row, with cost null", () => {
  const row = ttsUsageRow({ provider: "some-new-engine", chars: 1000, cached: false });
  assert.equal(row.costUsd, null, "unpriced is null so it lands in unpriced_calls, not in the sum as 0");
  assert.equal(row.model, null);
});

test("a cache hit is a counted call that spent nothing", () => {
  const row = ttsUsageRow({ provider: "elevenlabs", voiceId: "rachel", chars: 1000, cached: true, requestId: "k" });
  assert.equal(row.costUsd, 0, "no engine ran, so the zero is known — not null");
  assert.equal(row.source, "deterministic");
  assert.equal(row.provider, "elevenlabs", "still attributed to the provider whose bytes are being replayed");
});
