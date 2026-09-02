// @kazm/voice-stt — the contract. Nothing in this package imports the host app;
// the host binds it through `SttHost` (see registry.ts). One interface for the
// TRANSCRIPTION direction, adapters behind it, capability declared + probed,
// identity never branched on by callers.
//
// This is the sibling of @kazm/voice-tts, deliberately NOT a merge of it. The
// two directions share a settings page and nothing else: synthesis speaks text
// the product already holds, at a sensitivity the product already knows;
// transcription captures a person's voice in their room. That asymmetry is why
// the vocabulary below is ordered on-device-first, why `redaction` and
// `diarization` are capabilities a request can REQUIRE, and why asking for a
// capability the serving engine lacks is an error rather than a quiet downgrade.

/** The closed provider vocabulary. Adding a provider = add the literal here and
 *  an adapter under providers/ — registry, probes, UI pickers and preference
 *  parsing all derive from this list.
 *
 *  ORDER IS POLICY: with no host preference the registry serves the first ready
 *  provider in this order, so the on-device engine leads. For the input
 *  direction, where the audio goes is a privacy decision before it is a quality
 *  one, and a default that ships a candidate's voice to a vendor because it
 *  happened to be listed first is the wrong default to arrive at by accident. */
export const STT_PROVIDER_IDS = ["whisper_cpp", "assemblyai"] as const;
export type SttProviderId = (typeof STT_PROVIDER_IDS)[number];

export function isSttProviderId(value: unknown): value is SttProviderId {
  return typeof value === "string" && (STT_PROVIDER_IDS as readonly string[]).includes(value);
}

export type SttKind = "cloud" | "local";

/** Container types the door admits. An adapter narrows further (whisper.cpp
 *  wants 16 kHz mono PCM WAV and says so in its probe/error, rather than
 *  transcoding audio it was not asked to transcode). */
export const STT_MIME_TYPES = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg", "audio/flac"] as const;
export type SttMimeType = (typeof STT_MIME_TYPES)[number];

export function isSttMimeType(value: unknown): value is SttMimeType {
  return typeof value === "string" && (STT_MIME_TYPES as readonly string[]).includes(value);
}

/** What an adapter claims when healthy. Callers branch on THESE, never on `id`. */
export type SttCapabilities = {
  /** Can emit partial transcripts before the clip ends. This package is
   *  whole-clip; a true streaming transport is a different seam (a socket, not
   *  a request), so today every adapter declares false and the flag exists to
   *  keep surfaces from having to learn a second vocabulary when one does not. */
  streaming: boolean;
  /** BCP-47 primary tags the engine transcribes, or "any" for engines whose
   *  catalog is large enough that enumerating it here would go stale. */
  languages: readonly string[] | "any";
  /** Audio never leaves the machine. The single most consequential capability
   *  in this direction — a residency fact, not a performance one. */
  onDevice: boolean;
  /** Can label turns by speaker. */
  diarization: boolean;
  /** Can remove personally identifying spans before the transcript is returned. */
  redaction: boolean;
  /** Longest clip one transcribe() call should receive. */
  maxClipSeconds: number;
  /** Largest payload one transcribe() call should receive. */
  maxBytes: number;
};

/** Three distinguishable states — absent (offer setup) is not broken (offer
 *  repair) is not ready. Collapsing them strips the user of the fact that
 *  decides their next action. */
export type SttProbe =
  | { state: "ready"; detail?: string }
  | { state: "absent"; reason: string; setup?: string }
  | { state: "broken"; reason: string };

/** The capabilities a caller REQUIRES of whichever engine serves. The registry
 *  filters the resolution order by these rather than serving a provider that
 *  would silently drop one: a transcript that is missing the redaction it was
 *  asked for is not a degraded success, it is a privacy incident with a 200. */
export type SttNeeds = {
  diarization?: boolean;
  redaction?: boolean;
  /** Refuse any adapter that would send the audio off the machine. */
  onDevice?: boolean;
};

export type SttRequest = {
  audio: Uint8Array;
  mimeType: SttMimeType;
  /** BCP-47 hint. Null lets the engine detect, where it can. */
  language?: string | null;
  /** Engine-specific model id; validated by the one validation door. */
  modelId?: string | null;
  /** Label turns by speaker. Refused when the serving engine cannot. */
  diarize?: boolean | null;
  /** Redact PII spans. Refused when the serving engine cannot. */
  redactPii?: boolean | null;
};

export type SttSegment = {
  /** Seconds from the start of the clip. */
  start: number;
  end: number;
  text: string;
  /** Diarization label ("A", "B", …) or null when the engine did not label. */
  speaker: string | null;
  /** 0..1 where the engine reports one. */
  confidence: number | null;
};

export type SttTranscript = {
  text: string;
  segments: SttSegment[];
  /** What the engine says it heard, which may differ from the hint. */
  language: string | null;
  provider: SttProviderId;
  modelId: string | null;
  elapsedMs: number;
  /** Clip length where the adapter can determine it, else null. */
  durationMs: number | null;
  /** What the engine ACTUALLY did — never an echo of what was asked. A surface
   *  that prints "redacted" must read it from here. */
  diarized: boolean;
  redacted: boolean;
};

export interface SttProvider {
  readonly id: SttProviderId;
  readonly label: string;
  readonly kind: SttKind;
  /** Configuration the adapter reads through the host (names only, never values). */
  readonly requiredEnv: readonly string[];
  readonly capabilities: SttCapabilities;
  probe(): Promise<SttProbe>;
  /** Engine model ids this install can serve (a downloaded GGUF, a vendor tier). */
  models(): Promise<SttModel[]>;
  transcribe(req: SttRequest, signal?: AbortSignal): Promise<SttTranscript>;
}

export type SttModel = {
  id: string;
  label: string;
  /** BCP-47 primary tag when the model is single-language, null when multilingual. */
  language: string | null;
};

/** Everything the package needs from the app that embeds it. Keeping this
 *  narrow is what makes the package portable: secrets, logging, home-dir and
 *  working-dir policy belong to the host, not to an adapter. Identical in shape
 *  to TtsHost on purpose — one app binds both with one object. */
export interface SttHost {
  env(name: string): string | undefined;
  /** Where per-user local engines live (defaults to the OS home dir). */
  homeDir(): string;
  /** The app's working directory, for app-local model folders. */
  cwd(): string;
  log?(event: SttLogEvent): void;
}

export type SttLogEvent =
  | { type: "probe"; provider: SttProviderId; probe: SttProbe; ms: number }
  | { type: "transcribe"; provider: SttProviderId; modelId: string | null; bytes: number; ms: number; chars: number }
  | { type: "fallback"; from: SttProviderId; to: SttProviderId; reason: string }
  | { type: "error"; provider: SttProviderId; message: string };

/** The host's stance on which providers may serve and which is preferred.
 *  `allowed` is also the residency control: a deployment that must not send
 *  audio off the machine allows only on-device ids, and no per-request flag can
 *  widen it. */
export type SttPreference = {
  preferred: SttProviderId | null;
  allowed: readonly SttProviderId[];
};

/** One row of a probe-only status read — what a settings or onboarding surface renders. */
export type SttStatus = {
  id: SttProviderId;
  label: string;
  kind: SttKind;
  capabilities: SttCapabilities;
  probe: SttProbe;
  allowed: boolean;
  preferred: boolean;
};

export type SttResolution = {
  provider: SttProvider;
  /** Set when `provider` is not the one asked for — fallback is visible, never silent. */
  fallbackFrom: SttProviderId | null;
  reason: string | null;
};

/** The failure vocabulary. Callers branch on the CODE; the message is for a log
 *  and for an operator, never for a client to parse. Host HTTP mappings are
 *  written down once in docs/architecture/voice-stt-package.md — a code without
 *  a mapping is a code that reaches a surface as a generic 502. */
export type SttErrorCode =
  | "invalid_audio"
  | "invalid_language"
  | "invalid_model"
  /** The clip is longer than the serving engine's declared ceiling. Its own code
   *  rather than `invalid_audio` because the fix is different in kind: the audio
   *  is well-formed and the caller has to split or trim it, and a host that maps
   *  size to 413 wants to map length there too rather than to a flat 400. */
  | "too_long"
  | "unsupported"
  | "unavailable"
  /** The engine asked us to slow down. Distinguishable from `engine_failed`
   *  because it is not a fault and the request is worth repeating — with
   *  `retryAfterMs` when the engine said how long to wait. */
  | "rate_limited"
  | "engine_failed"
  | "timeout"
  | "aborted";

export class SttError extends Error {
  constructor(
    readonly code: SttErrorCode,
    message: string,
    readonly provider?: SttProviderId,
    /** Only meaningful for `rate_limited`: how long the engine asked us to wait,
     *  parsed from its own answer. Null/undefined = it did not say. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "SttError";
  }
}
