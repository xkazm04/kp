import { VOICE_PROVIDER_ORDER, type VoiceAvailability, type VoiceProviderId } from "./types.ts";

// What each realtime voice provider IS, declared once beside VOICE_PROVIDER_ORDER
// (challenge-r09 voice-provider-io/A). The adapters (openai.ts, elevenlabs.ts) were
// clean, but the knowledge of what each one does had leaked into the seams around
// them: a two-member failover complement, the free-to-paid rule spelled
// `openai: false` in one route, the prompt plane and the ASR bias decided by
// `=== "elevenlabs"`, the relay provider hardcoded in the intake route. Every seam
// now asks what a provider CAN do; adding a provider is one adapter plus one row.
//
// Browser-safe on purpose: pure data plus pure functions, importing only the pure
// vocabulary in ./types.ts, because preflight.ts (browser code) reads the transport.
//
// The CLIENT half of the same contract is CallTransport's capabilities
// (app/_components/voice/transport/call-transport.ts, r08). The two must agree on
// the wire: `transport: "webrtc"` is the engine whose CallTransport finalizes
// `immediate` (the OpenAI peer connection), `transport: "websocket"` the one that
// finalizes on `disconnect` (the ElevenLabs Agents socket). This table decides what
// the server mints and the browser pre-flights; that one decides how a live call
// ends. Neither names the other's fields, so a new provider owes a row in both.

export type VoiceProviderTraits = {
  /** How the browser reaches the provider: a WebRTC peer connection (needs
   *  RTCPeerConnection, checked by voicePreflightCode) or a signed WebSocket. */
  readonly transport: "webrtc" | "websocket";
  /** Where the interviewer brief is delivered. "server": minted into the session
   *  server-side, so /connect hands the browser no prompt. "client-override": the
   *  provider holds its own agent prompt and the browser pushes the candidate-safe
   *  brief as an override. */
  readonly prompt: "server" | "client-override";
  /** Whether the browser can bias the provider's speech recognizer with keywords
   *  (job terms). A provider whose transcription is configured server-side takes none. */
  readonly asrKeywords: boolean;
  /** Whether the provider honors `relay: true` (transport-only: it transcribes and
   *  speaks what it is told, never on its own). The intake voice plane needs this. */
  readonly relay: boolean;
  /** Whether the provider can be served from a machine the operator runs, and so
   *  cost no per-minute credits. Today that is the ElevenLabs-compatible Agents
   *  protocol at ELEVENLABS_BASE_URL (self-hosted.ts), which decides whether a
   *  given install actually IS local. */
  readonly selfHostable: boolean;
  /** What identifies the model a session's minutes are attributed to: the
   *  env-resolved realtime model, or the configured agent id. */
  readonly modelIdentity: "realtime-model" | "agent-id";
};

export const VOICE_PROVIDER_TRAITS: Readonly<Record<VoiceProviderId, VoiceProviderTraits>> = {
  openai: {
    transport: "webrtc",
    prompt: "server",
    asrKeywords: false,
    relay: true,
    selfHostable: false,
    modelIdentity: "realtime-model",
  },
  elevenlabs: {
    transport: "websocket",
    prompt: "client-override",
    asrKeywords: true,
    relay: false,
    selfHostable: true,
    modelIdentity: "agent-id",
  },
};

export function providerTraits(id: VoiceProviderId): VoiceProviderTraits {
  return VOICE_PROVIDER_TRAITS[id];
}

/** The alternates to try, in canonical order, when `preferred` fails to connect:
 *  every AVAILABLE provider except the preferred one. A preferred provider that is
 *  FREE (isFree: self-hosted for this install) is only ever rescued onto another
 *  free one: its session skipped /simulate's minute gate, so landing it on a paid
 *  provider would price and debit a call against a reservation never taken. */
export function failoverOrder(
  preferred: VoiceProviderId,
  availability: VoiceAvailability,
  isFree: (id: VoiceProviderId) => boolean,
  order: readonly VoiceProviderId[] = VOICE_PROVIDER_ORDER,
): VoiceProviderId[] {
  const freeOnly = isFree(preferred);
  return order.filter((id) => id !== preferred && availability[id] === true && (!freeOnly || isFree(id)));
}

/** The relay-capable providers, in canonical order. */
export function relayCapableProviders(
  order: readonly VoiceProviderId[] = VOICE_PROVIDER_ORDER,
  traits: Readonly<Record<VoiceProviderId, VoiceProviderTraits>> = VOICE_PROVIDER_TRAITS,
): VoiceProviderId[] {
  return order.filter((id) => traits[id]?.relay === true);
}

/** The first relay-capable provider that is configured, or null when none is. */
export function relayProvider(
  availability: VoiceAvailability,
  order: readonly VoiceProviderId[] = VOICE_PROVIDER_ORDER,
  traits: Readonly<Record<VoiceProviderId, VoiceProviderTraits>> = VOICE_PROVIDER_TRAITS,
): VoiceProviderId | null {
  return relayCapableProviders(order, traits).find((id) => availability[id] === true) ?? null;
}

/** The provider a not-configured relay answer names (with ITS missing env): the
 *  first relay-capable one. Throws only if the table declares no relay provider at
 *  all, which is a programming error rather than an install state. */
export function relayFallbackProvider(
  order: readonly VoiceProviderId[] = VOICE_PROVIDER_ORDER,
  traits: Readonly<Record<VoiceProviderId, VoiceProviderTraits>> = VOICE_PROVIDER_TRAITS,
): VoiceProviderId {
  const first = relayCapableProviders(order, traits)[0];
  if (!first) throw new Error("no voice provider declares the relay trait");
  return first;
}
