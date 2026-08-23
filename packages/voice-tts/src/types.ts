// @kazm/voice-tts — the contract. Nothing in this package imports the host app;
// the host binds it through `TtsHost` (see registry.ts). One interface for the
// synthesis direction, adapters behind it, capability declared + probed,
// identity never branched on by callers.

/** The closed provider vocabulary. Adding a provider = add the literal here and
 *  an adapter under providers/ — registry, probes, UI pickers and preference
 *  parsing all derive from this list. */
export const TTS_PROVIDER_IDS = ["elevenlabs", "piper", "kokoro"] as const;
export type TtsProviderId = (typeof TTS_PROVIDER_IDS)[number];

export function isTtsProviderId(value: unknown): value is TtsProviderId {
  return typeof value === "string" && (TTS_PROVIDER_IDS as readonly string[]).includes(value);
}

export type TtsKind = "cloud" | "local";

/** What an adapter claims when healthy. Callers branch on THESE, never on `id`. */
export type TtsCapabilities = {
  /** Can return audio before the whole utterance is synthesized. */
  streaming: boolean;
  /** BCP-47 primary tags the engine speaks, or "any" for multilingual engines
   *  that pick a voice per language. */
  languages: readonly string[] | "any";
  /** Honors `TtsRequest.speed`. */
  speed: boolean;
  /** Audio never leaves the machine. */
  onDevice: boolean;
  /** Longest text one synthesize() call should receive. Latency scales with
   *  length (a CPU engine renders ~2x real time: 1200 chars is ~35 s before
   *  the first word), so the registry segments above this and joins clips. */
  maxClipChars: number;
};

/** Three distinguishable states — absent (offer setup) is not broken (offer
 *  repair) is not ready. Collapsing them strips the user of the fact that
 *  decides their next action. */
export type TtsProbe =
  | { state: "ready"; detail?: string }
  | { state: "absent"; reason: string; setup?: string }
  | { state: "broken"; reason: string };

export type TtsVoice = {
  id: string;
  label: string;
  /** BCP-47 primary tag ("en", "cs") or null when the voice is multilingual. */
  language: string | null;
};

export type TtsRequest = {
  text: string;
  /** Language hint — picks a default voice on engines with per-language voices. */
  language?: string | null;
  /** Engine-specific voice id; validated by the one validation door (validate.ts). */
  voiceId?: string | null;
  /** 1 = native rate. Ignored when `capabilities.speed` is false. */
  speed?: number | null;
  /** "chat": the text is an assistant reply — markdown, code, links and emoji
   *  are stripped by the validation door before any engine sees it. */
  format?: "plain" | "chat" | null;
};

export type TtsAudio = {
  bytes: Uint8Array;
  mimeType: "audio/wav" | "audio/mpeg";
  provider: TtsProviderId;
  voiceId: string;
  elapsedMs: number;
  /** How many synthesis calls produced this clip (1 = unsegmented). */
  segments?: number;
};

export interface TtsProvider {
  readonly id: TtsProviderId;
  readonly label: string;
  readonly kind: TtsKind;
  /** Configuration the adapter reads through the host (names only, never values). */
  readonly requiredEnv: readonly string[];
  readonly capabilities: TtsCapabilities;
  probe(): Promise<TtsProbe>;
  voices(): Promise<TtsVoice[]>;
  synthesize(req: TtsRequest, signal?: AbortSignal): Promise<TtsAudio>;
}

/** Everything the package needs from the app that embeds it. Keeping this
 *  narrow is what makes the package portable: secrets, logging, home-dir and
 *  working-dir policy belong to the host, not to an adapter. */
export interface TtsHost {
  env(name: string): string | undefined;
  /** Where per-user local engines live (defaults to the OS home dir). */
  homeDir(): string;
  /** The app's working directory, for app-local model folders. */
  cwd(): string;
  log?(event: TtsLogEvent): void;
}

export type TtsLogEvent =
  | { type: "probe"; provider: TtsProviderId; probe: TtsProbe; ms: number }
  | { type: "synthesize"; provider: TtsProviderId; voiceId: string; chars: number; ms: number; bytes: number }
  | { type: "fallback"; from: TtsProviderId; to: TtsProviderId; reason: string }
  | { type: "error"; provider: TtsProviderId; message: string };

/** The host's stance on which providers may serve and which is preferred.
 *  `allowed` is the compare set the UI may expose; `preferred` is what an
 *  onboarding/settings flow wrote down. Neither is trusted blindly — resolve()
 *  probes before serving. */
export type TtsPreference = {
  preferred: TtsProviderId | null;
  allowed: readonly TtsProviderId[];
};

/** One row of a probe-only status read — what a settings or compare surface renders. */
export type TtsStatus = {
  id: TtsProviderId;
  label: string;
  kind: TtsKind;
  capabilities: TtsCapabilities;
  probe: TtsProbe;
  /** In the host's compare set (preference.allowed). */
  allowed: boolean;
  preferred: boolean;
};

export type TtsResolution = {
  provider: TtsProvider;
  /** Set when `provider` is not the one asked for — fallback is visible, never silent. */
  fallbackFrom: TtsProviderId | null;
  reason: string | null;
};

export type TtsErrorCode = "invalid_text" | "invalid_voice" | "unavailable" | "engine_failed" | "timeout" | "aborted";

export class TtsError extends Error {
  constructor(
    readonly code: TtsErrorCode,
    message: string,
    readonly provider?: TtsProviderId,
  ) {
    super(message);
    this.name = "TtsError";
  }
}
