// Locks the voice-minute cost-attribution contract (backlog item 16 / tiger F1):
// the interview_minutes meter is quantity-only, so a completed session ALSO
// writes an llm_usage ledger row attributing the minutes to the provider/model
// that served them, with a duration-derived cost estimate from the per-minute
// price map. These tests pin the pure row builder; the complete route wraps it
// with insertLlmUsage (see complete-usage-attribution.test.ts for the
// end-to-end write).
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { VOICE_MINUTE_PRICES, voiceMinuteCostUsd, voiceSessionModel, voiceUsageRow } from "./minute-prices.ts";
import { VOICE_PROVIDER_ORDER } from "./types.ts";

// Run `fn` with the given env vars set (undefined ⇒ cleared), restoring the
// previous values after — the model resolvers read process.env live, so the
// suite must not depend on the machine's real config.
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = new Map(Object.keys(vars).map((n) => [n, process.env[n]]));
  for (const [n, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[n];
    else process.env[n] = v;
  }
  try {
    fn();
  } finally {
    for (const [n, v] of saved) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

test("every voice provider has a per-minute price (coverage contract, mirroring MTOK_PRICES)", () => {
  // A provider added to VOICE_PROVIDER_ORDER without a price row would silently
  // escape cost accounting — the same coverage contract test_llm_base.py pins
  // for MTOK_PRICES.
  for (const provider of VOICE_PROVIDER_ORDER) {
    const price = VOICE_MINUTE_PRICES[provider];
    assert.equal(typeof price, "number", `${provider} must carry a per-minute price`);
    assert.ok(price > 0 && price < 1, `${provider} per-minute price must be a plausible USD figure`);
  }
});

test("voiceMinuteCostUsd derives cost from the clamped minute count", () => {
  assert.equal(voiceMinuteCostUsd("openai", 1), VOICE_MINUTE_PRICES.openai);
  assert.equal(voiceMinuteCostUsd("openai", 10), Math.round(VOICE_MINUTE_PRICES.openai * 10 * 1e6) / 1e6);
  assert.equal(voiceMinuteCostUsd("elevenlabs", 8), Math.round(VOICE_MINUTE_PRICES.elevenlabs * 8 * 1e6) / 1e6);
});

test("openai sessions attribute to the env-resolved realtime model", () => {
  withEnv({ OPENAI_REALTIME_MODEL: undefined }, () => {
    assert.equal(voiceSessionModel("openai"), "gpt-realtime");
  });
  withEnv({ OPENAI_REALTIME_MODEL: "gpt-realtime-mini" }, () => {
    assert.equal(voiceSessionModel("openai"), "gpt-realtime-mini");
  });
});

test("elevenlabs sessions attribute to the dashboard agent id (null when unset)", () => {
  withEnv({ ELEVENLABS_AGENT_ID: "agent_unit_test" }, () => {
    assert.equal(voiceSessionModel("elevenlabs"), "agent_unit_test");
  });
  withEnv({ ELEVENLABS_AGENT_ID: undefined }, () => {
    assert.equal(voiceSessionModel("elevenlabs"), null);
  });
});

test("voiceUsageRow builds the fully attributed ledger row for a completed session", () => {
  withEnv({ OPENAI_REALTIME_MODEL: undefined }, () => {
    assert.deepEqual(voiceUsageRow({ id: "iv_123", provider: "openai" }, 7), {
      useCase: "interview_realtime",
      provider: "openai",
      model: "gpt-realtime",
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      costUsd: voiceMinuteCostUsd("openai", 7),
      source: "llm",
      requestId: "iv_123",
    });
  });
});

test("voiceUsageRow carries the serving provider — the two providers cost differently", () => {
  withEnv({ ELEVENLABS_AGENT_ID: undefined }, () => {
    const row = voiceUsageRow({ id: "iv_el", provider: "elevenlabs" }, 7);
    assert.equal(row.provider, "elevenlabs");
    assert.equal(row.model, null);
    assert.equal(row.costUsd, voiceMinuteCostUsd("elevenlabs", 7));
    assert.notEqual(row.costUsd, voiceMinuteCostUsd("openai", 7));
  });
});
