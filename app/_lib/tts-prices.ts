import type { LlmUsageInput } from "./llm-usage-ledger";
import type { TtsProviderId } from "@/packages/voice-tts/src/index";

// Per-character prices for the synthesis providers, used to stamp a cost_usd
// estimate on the llm_usage ledger row written for every /api/tts synthesis.
// The sibling of app/_lib/voice/minute-prices.ts, which does the same job for
// the realtime interview plane — and the gap this closes: the conversation
// plane wrote `cost_usd` rows for every billed minute while the companion's
// spoken channel, the one paid leg the dock walks on its own, wrote a console
// line. Spend that is not in the ledger is not in the Models usage panel, not
// in the billing spend fold, and not in any total an operator can audit.
//
// Same conventions as MTOK_PRICES in pipeline/jobfit/llm/base.py and
// minute-prices.ts:
//   - these are LOCAL ESTIMATES, not contractual rates. Verify against the
//     provider's price book before billing on them.
//   - a provider with no row here is UNPRICED (cost_usd null → counted as
//     `unpriced_calls`), never zero. "Unknown cost" and "cost nothing" are
//     different facts and the ledger already has a word for each.
//
// ElevenLabs is plan-priced per character: the Creator/Pro tiers land around
// $0.18-0.30 per 1000 characters depending on the bundle, so 0.22 splits that
// band. Piper and Kokoro run on the operator's own machine — no per-character
// credits are spent, so their zero is a KNOWN zero (the same reasoning
// `isSelfHostedProvider` applies to a self-hosted realtime session), and it is
// deliberately not the same value as "we do not know".
export const TTS_KCHAR_PRICES: Record<TtsProviderId, number> = {
  elevenlabs: 0.22,
  piper: 0,
  kokoro: 0,
};

/** Estimated USD cost of synthesizing `chars` characters on `provider`, rounded
 *  to 6 decimals like base.py's price_usd — or null when the provider has no
 *  price row (unknown, never zero) or the character count is not a usable
 *  non-negative number. */
export function ttsCostUsd(provider: string, chars: number): number | null {
  const price = (TTS_KCHAR_PRICES as Record<string, number | undefined>)[provider];
  if (price === undefined) return null;
  if (!Number.isFinite(chars) || chars < 0) return null;
  return Math.round((price * chars) / 1000 * 1e6) / 1e6;
}

/** One synthesis (or one cache hit) as an llm_usage ledger row.
 *
 *  Token columns stay NULL, exactly as `voiceUsageRow` leaves them for a voice
 *  session: characters are not tokens, and summing them into `input_tokens`
 *  would put two different units in one column that `aggregateLlmUsage` adds
 *  up. What the row carries instead is the fact that pays: the provider, the
 *  voice it served with, and the cost those characters imply.
 *
 *  A CACHE HIT is `source: "deterministic"` with `costUsd: 0` — no engine ran,
 *  so nothing was spent, and the row exists so the call is still counted. The
 *  billing spend fold splits fallbacks on `provider`, not on `source`, so a
 *  cached row lands in the same provider's bucket with a truthful zero rather
 *  than disappearing from the call count. `requestId` carries the cache key, so
 *  a hit and the miss that filled it are traceable to each other. */
export function ttsUsageRow(call: {
  provider: string;
  voiceId?: string | null;
  chars: number;
  cached: boolean;
  requestId?: string | null;
}): LlmUsageInput {
  return {
    useCase: "tts",
    provider: call.provider,
    model: call.voiceId ?? null,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    costUsd: call.cached ? 0 : ttsCostUsd(call.provider, call.chars),
    source: call.cached ? "deterministic" : "llm",
    // A synthesis that RETURNED — the only kind this row is built for; the route
    // writes it after the audio is in hand. A failed synthesis has no row here.
    outcome: "ok",
    requestId: call.requestId ?? null,
  };
}
