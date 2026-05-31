// Provider-agnostic voice-interview adapter, mirroring comms.ts's CommsChannel
// pattern. The server mints SHORT-LIVED client credentials per provider so the
// real API key never reaches the browser; the browser then connects directly to
// the provider over WebRTC (OpenAI) or the provider SDK (ElevenLabs).

export type VoiceProviderId = "openai" | "elevenlabs";

/** What the browser needs to open an OpenAI Realtime WebRTC session. */
export type OpenAiConnect = {
  provider: "openai";
  model: string;
  /** Ephemeral client secret (expires in ~1 min) — safe to send to the browser. */
  clientSecret: string;
  /** Endpoint the browser POSTs its SDP offer to. */
  callsUrl: string;
};

/** What the browser needs to open an ElevenLabs Agents session. */
export type ElevenLabsConnect = {
  provider: "elevenlabs";
  /** Short-lived signed WebSocket URL for the configured agent. */
  signedUrl: string;
};

export type VoiceConnect = OpenAiConnect | ElevenLabsConnect;

export type VoiceAvailability = Record<VoiceProviderId, boolean>;

export interface VoiceAdapter {
  readonly id: VoiceProviderId;
  /** True when the required API keys/agent are configured. */
  available(): boolean;
  /** Mint browser-safe, short-lived credentials for one session. */
  connect(opts: { instructions: string; language?: string | null }): Promise<VoiceConnect>;
}
