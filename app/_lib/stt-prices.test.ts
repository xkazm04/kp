import { test } from "node:test";
import assert from "node:assert/strict";
import { STT_HOUR_PRICES, sttCostUsd, sttUsageRow } from "./stt-prices.ts";

test("a cloud transcript is priced per AUDIO HOUR, rounded to 6 decimals", () => {
  assert.equal(sttCostUsd("assemblyai", 3_600_000), STT_HOUR_PRICES.assemblyai);
  // A 12-minute interview clip is a fifth of an hour.
  assert.equal(sttCostUsd("assemblyai", 720_000), Math.round(0.27 * 0.2 * 1e6) / 1e6);
});

test("a local engine costs a KNOWN zero, even when the clip length is unknown", () => {
  assert.equal(sttCostUsd("whisper_cpp", 3_600_000), 0);
  assert.equal(sttCostUsd("whisper_cpp", null), 0, "nothing is billed per hour, so no length can make it non-zero");
});

test("an unpriced provider is UNKNOWN cost, never zero", () => {
  assert.equal(sttCostUsd("some-new-engine", 3_600_000), null);
  assert.equal(sttCostUsd("", 3_600_000), null);
});

test("a cloud clip of unknown or nonsense length is unknown cost, not a fabricated one", () => {
  assert.equal(sttCostUsd("assemblyai", null), null);
  assert.equal(sttCostUsd("assemblyai", undefined), null);
  assert.equal(sttCostUsd("assemblyai", -1), null);
  assert.equal(sttCostUsd("assemblyai", Number.NaN), null);
});

test("a transcript ledger row carries provider, model and cost — and no token counts", () => {
  const row = sttUsageRow({ provider: "assemblyai", modelId: "universal", durationMs: 3_600_000, requestId: "r1" });
  assert.equal(row.useCase, "stt");
  assert.equal(row.provider, "assemblyai");
  assert.equal(row.model, "universal");
  assert.equal(row.source, "llm", "an engine ran; there is no transcription cache to answer for");
  assert.equal(row.costUsd, 0.27);
  assert.equal(row.requestId, "r1");
  // Audio seconds are not tokens: aggregateLlmUsage sums these columns across
  // every use case, so a duration here would be two units in one sum.
  assert.equal(row.inputTokens, null);
  assert.equal(row.outputTokens, null);
  assert.equal(row.cachedTokens, null);
});

test("an unpriced provider still gets a counted row, with cost null", () => {
  const row = sttUsageRow({ provider: "some-new-engine", durationMs: 60_000 });
  assert.equal(row.costUsd, null, "unpriced is null so it lands in unpriced_calls, not in the sum as 0");
  assert.equal(row.model, null);
  assert.equal(row.requestId, null);
});

test("every registered provider has a price row — a new engine is not silently unpriced", async () => {
  const { STT_PROVIDER_IDS } = await import("@/packages/voice-stt/src/index");
  for (const id of STT_PROVIDER_IDS) {
    assert.equal(typeof STT_HOUR_PRICES[id], "number", `${id} needs a price row (a KNOWN zero if it is on-device)`);
  }
});
