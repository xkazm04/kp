import type { LlmUsageInput } from "./llm-usage-ledger";
import type { SttProviderId } from "@/packages/voice-stt/src/index";

// Per-audio-HOUR prices for the transcription providers, used to stamp a
// cost_usd estimate on the llm_usage ledger row written for every /api/stt
// transcript. The third of the three voice meters, beside tts-prices.ts
// (per character) and app/_lib/voice/minute-prices.ts (per realtime minute) —
// and the gap this closes: every other paid voice leg wrote a ledger row while
// the input plane, whose cloud path is billed per audio hour, wrote nothing.
// Spend that is not in the ledger is not in the Models usage panel, not in the
// billing spend fold, and not in any total an operator can audit.
//
// THE UNIT IS THE AUDIO HOUR, not wall clock. What is billed is the length of
// the clip, not how long the engine took to chew it, so this prices
// `SttTranscript.durationMs` and never `elapsedMs`. On the cloud path the
// vendor reports the duration it billed for (`audio_duration`), which is the
// right number to price by definition; on the local path the WAV header gives
// it, and where neither can say, the cost is unknown (see below).
//
// Same conventions as MTOK_PRICES in pipeline/jobfit/llm/base.py,
// minute-prices.ts and tts-prices.ts:
//   - these are LOCAL ESTIMATES, not contractual rates. Verify against the
//     provider's price book before billing on them.
//   - a provider with no row here is UNPRICED (cost_usd null, counted as
//     `unpriced_calls`), never zero. "Unknown cost" and "cost nothing" are
//     different facts and the ledger already has a word for each.
//
// AssemblyAI publishes a list price per audio hour for its asynchronous
// Universal model: $0.27/hour as listed on assemblyai.com/pricing, the figure
// this row was written from on 2026-09-05. Two things it deliberately does NOT
// model, both of which push the real bill UP: diarization (`speaker_labels`)
// and PII redaction are priced add-ons, and volume commitments push it down.
// So this is a floor estimate for the base transcription, which is the honest
// thing a self-hosted ledger can claim; an operator on a negotiated rate should
// change the number here rather than trust it.
//
// whisper.cpp runs on the operator's own CPU: no per-hour credits are spent, so
// its zero is a KNOWN zero (the same reasoning `isSelfHostedProvider` applies to
// a self-hosted realtime session and `piper`/`kokoro` to synthesis), and it is
// deliberately not the same value as "we do not know".
export const STT_HOUR_PRICES: Record<SttProviderId, number> = {
  whisper_cpp: 0,
  assemblyai: 0.27,
};

const MS_PER_HOUR = 3_600_000;

/** Estimated USD cost of transcribing `durationMs` of audio on `provider`,
 *  rounded to 6 decimals like base.py's price_usd — or null when the provider
 *  has no price row (unknown, never zero) or the duration is not a usable
 *  non-negative number.
 *
 *  A KNOWN-zero engine answers 0 even with an unknown duration: nothing is
 *  billed per hour, so no length can make the bill non-zero, and returning null
 *  there would file a local transcript under `unpriced_calls` and tell an
 *  operator auditing their spend that kp does not know what the on-device
 *  engine costs. It does. */
export function sttCostUsd(provider: string, durationMs: number | null | undefined): number | null {
  const price = (STT_HOUR_PRICES as Record<string, number | undefined>)[provider];
  if (price === undefined) return null;
  if (price === 0) return 0;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) return null;
  return Math.round((price * durationMs) / MS_PER_HOUR * 1e6) / 1e6;
}

/** One transcript as an llm_usage ledger row.
 *
 *  Token columns stay NULL, exactly as `ttsUsageRow` and `voiceUsageRow` leave
 *  them: audio seconds are not tokens, and summing them into `input_tokens`
 *  would put two different units in one column that `aggregateLlmUsage` adds
 *  up. What the row carries instead is the fact that pays: the provider, the
 *  engine model it served with, and the cost that clip's length implies.
 *
 *  `source` is always "llm" — an engine ran for every row this writes. There is
 *  no transcription cache to answer for: unlike synthesis, where the same
 *  sentence is spoken twice, no two uploads are the same clip. */
export function sttUsageRow(call: {
  provider: string;
  modelId?: string | null;
  durationMs?: number | null;
  requestId?: string | null;
}): LlmUsageInput {
  return {
    useCase: "stt",
    provider: call.provider,
    model: call.modelId ?? null,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    costUsd: sttCostUsd(call.provider, call.durationMs),
    source: "llm",
    // A served transcript is a completed call; the failure branch never reaches
    // this row (llm-usage-ledger.ts: outcome is explicit so no row class joins a
    // total by accident).
    outcome: "ok",
    requestId: call.requestId ?? null,
  };
}
