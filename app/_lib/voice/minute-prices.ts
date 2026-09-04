import type { LlmUsageInput } from "../llm-usage-ledger";
import { openAiRealtimeModel } from "./openai.ts";
import { isSelfHostedProvider } from "./self-hosted.ts";
import type { VoiceProviderId } from "./types.ts";

// Per-minute prices for the voice-interview providers, used to stamp a
// cost_usd estimate on the llm_usage ledger row written when a session
// completes (tiger F1: the interview_minutes meter is quantity-only, so
// minutes were billed with no provider/model/cost attribution although the
// two providers' per-minute costs differ materially).
//
// Mirrors the MTOK_PRICES conventions in pipeline/jobfit/llm/base.py: unknown
// providers would carry cost_usd=null and still be metered by quantity, and —
// NOTE — these are LOCAL ESTIMATES, not contractual rates. Verify against each
// provider's price book before billing on them:
//   - OpenAI Realtime: usage is token-priced (audio in/out); public estimates
//     land around ~$0.06–0.24 per conversation minute depending on the
//     talk/listen mix — 0.15 is the midpoint of that range.
//   - ElevenLabs Agents: plan-priced per minute, ~$0.08–0.10/min on
//     Creator/Pro tiers (lower on Business) — 0.09 splits that band.
export const VOICE_MINUTE_PRICES: Record<VoiceProviderId, number> = {
  openai: 0.15,
  elevenlabs: 0.09,
};

/** The env var an operator sets to replace the estimate above with the rate they
 *  actually pay. The estimates are midpoints of PUBLIC price bands (see the block
 *  comment); an operator on an ElevenLabs Business tier, an Azure-brokered
 *  Realtime contract, or a negotiated rate is priced wrong by construction, and
 *  the ledger they reconcile spend against was the one number they could not
 *  correct without a code change. USD per conversation minute. */
const VOICE_MINUTE_PRICE_ENV: Record<VoiceProviderId, string> = {
  openai: "KP_VOICE_MINUTE_USD_OPENAI",
  elevenlabs: "KP_VOICE_MINUTE_USD_ELEVENLABS",
};

/** The per-minute price in force for `provider`: the operator's override when one
 *  is set and parses as a finite, non-negative number, otherwise this repo's
 *  estimate. Read at CALL time (never module load) so a test — and an operator
 *  restarting with a new value — sees the current env, like openAiRealtimeModel().
 *
 *  A malformed override is REFUSED rather than coerced: `Number("")` is 0 and
 *  `Number("$0.12")` is NaN, and silently pricing every interview at zero (or at
 *  NaN, which lands as `null` in the ledger) would be a worse lie than the
 *  estimate it replaced. It says so on the console once per call — the operator
 *  who typed it is the only person who can fix it. */
export function voiceMinutePriceUsd(provider: VoiceProviderId): number {
  const name = VOICE_MINUTE_PRICE_ENV[provider];
  const raw = process.env[name];
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    console.warn(
      `[voice] ${name}="${raw}" is not a non-negative number — falling back to the built-in ` +
        `estimate (${VOICE_MINUTE_PRICES[provider]} USD/min) for ${provider}.`
    );
  }
  return VOICE_MINUTE_PRICES[provider];
}

/** Estimated USD cost of `minutes` on `provider`, rounded to 6 decimals like
 *  base.py's price_usd. Callers pass the SAME clamped minute count the billing
 *  meter was debited with, so the ledger estimate and the metered quantity can
 *  never disagree. "Estimated" stays literal on the default path — the
 *  disclaimer above still applies to every install that sets no override. */
export function voiceMinuteCostUsd(provider: VoiceProviderId, minutes: number): number {
  // A session served from a machine we run costs no per-minute credits. Leaving
  // the hosted price on those rows would inflate every cost report by the exact
  // spend that moving the workload in-house was meant to remove.
  if (isSelfHostedProvider(provider)) return 0;
  return Math.round(voiceMinutePriceUsd(provider) * minutes * 1e6) / 1e6;
}

/** The model identity to attribute a session's minutes to. OpenAI sessions run
 *  the env-resolved realtime model; ElevenLabs sessions run a dashboard-
 *  configured agent with no public model id, so the agent id is the closest
 *  stable identity (mirroring how Azure's customer-named deployments are
 *  attributed in MTOK_PRICES), null when unset. */
export function voiceSessionModel(provider: VoiceProviderId): string | null {
  if (provider === "openai") return openAiRealtimeModel();
  return process.env.ELEVENLABS_AGENT_ID ?? null;
}

/** Build the attributed llm_usage ledger row for one completed voice session —
 *  use_case "interview_realtime", the serving provider + model, and a
 *  duration-derived cost estimate. Token counts stay null (the realtime
 *  providers do not report them at hang-up); source is "llm" because a real
 *  provider served the call. `requestId` carries the session id so a ledger row
 *  is traceable back to its interview. Kept pure (no DB import) so it is
 *  unit-testable under node --test; the complete route wraps it with
 *  insertLlmUsage. */
export function voiceUsageRow(session: { id: string; provider: VoiceProviderId }, minutes: number): LlmUsageInput {
  return {
    useCase: "interview_realtime",
    provider: session.provider,
    model: voiceSessionModel(session.provider),
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    costUsd: voiceMinuteCostUsd(session.provider, minutes),
    source: "llm",
    requestId: session.id,
  };
}
