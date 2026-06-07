// Provider-agnostic voice-interview adapter, mirroring comms.ts's CommsChannel
// pattern. The server mints SHORT-LIVED client credentials per provider so the
// real API key never reaches the browser; the browser then connects directly to
// the provider over WebRTC (OpenAI) or the provider SDK (ElevenLabs).

export type VoiceProviderId = "openai" | "elevenlabs";

/** Narrow an untrusted value to a VoiceProviderId — the single source of
 *  provider-id validation shared by the create/connect routes and the DB row
 *  mapper, so adding or renaming a provider is a one-line change here.
 *  With no fallback, returns null when the value isn't a known provider (lets a
 *  caller fall through to a stored/default choice); with a fallback, always
 *  returns a VoiceProviderId. */
export function coerceProviderId(value: unknown): VoiceProviderId | null;
export function coerceProviderId(value: unknown, fallback: VoiceProviderId): VoiceProviderId;
export function coerceProviderId(value: unknown, fallback: VoiceProviderId | null = null): VoiceProviderId | null {
  return value === "openai" || value === "elevenlabs" ? value : fallback;
}

/** Narrow an untrusted value to a plausible BCP-47-ish language hint, or null.
 *  The interview routes used to store `body.language` verbatim — an unbounded
 *  attacker-controlled string persisted to the session row and echoed into
 *  provider connect calls (idea-c7df6b55). The UI only ever sends "cs"/"en",
 *  but the boundary shouldn't rely on that. */
export function coerceLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.length <= 16 && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value) ? value : null;
}

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

/** One line of an interview transcript — the single canonical shape shared by
 *  the browser (which appends turns live and POSTs them on hang-up), the
 *  interview_sessions DB row mapper, and the scorecard/notes builders. `at`
 *  (ISO timestamp) is optional: the live client always stamps it, but persisted
 *  or externally-generated transcripts may omit it, so the superset keeps the
 *  compiler honest across every layer without forcing a timestamp that isn't
 *  guaranteed to exist. */
export type VoiceTurn = { role: "candidate" | "interviewer" | "system"; text: string; at?: string };

export interface VoiceAdapter {
  readonly id: VoiceProviderId;
  /** The env vars this provider needs before it can mint credentials. This is
   *  the single source of truth for which keys a provider requires: available()
   *  derives from it, and the connect route builds its "not configured" message
   *  from it (see missingVoiceEnv), so adding a provider or renaming a var is a
   *  one-file change here instead of three disconnected edits. */
  readonly requiredEnv: readonly string[];
  /** True when the required API keys/agent are configured. */
  available(): boolean;
  /** Mint browser-safe, short-lived credentials for one session. */
  connect(opts: { instructions: string; language?: string | null }): Promise<VoiceConnect>;
}

/** Which of an adapter's requiredEnv vars are currently unset — empty when the
 *  provider is fully configured. Both available() and the connect route's
 *  not-configured message run through this, so the message can never drift from
 *  the actual check and the route never re-encodes provider-specific var names. */
export function missingVoiceEnv(adapter: VoiceAdapter): string[] {
  return adapter.requiredEnv.filter((name) => !process.env[name]);
}
