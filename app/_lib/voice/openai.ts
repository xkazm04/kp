import { missingVoiceEnv, type OpenAiConnect, type VoiceAdapter } from "./types.ts";

// OpenAI Realtime (gpt-realtime, GA). Browser uses WebRTC; the server mints an
// ephemeral client secret via /v1/realtime/client_secrets and the browser POSTs
// its SDP offer to /v1/realtime/calls. Model/voice/transcription are env-overridable
// because the realtime model line moves quickly.

/** The realtime model this adapter serves (env-overridable because the realtime
 *  model line moves quickly). Resolved at CALL time (not module load) and
 *  exported so the usage ledger can attribute a completed session's minutes to
 *  the model that served them (see voice/minute-prices.ts). */
export function openAiRealtimeModel(): string {
  return process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
}

const VOICE = process.env.OPENAI_REALTIME_VOICE ?? "marin";
// Input transcription model. Defaults to a STREAMING model (emits `.delta`s) so the
// finalize fallback for a candidate's last answer still in flight at hang-up — which
// reads from the streamed delta buffer — actually has content. whisper-1 emits ONLY
// the final `.completed` (no deltas), so under it that fallback was provably empty
// and a slow closing answer could be silently dropped from the scored transcript.
// Override (incl. back to "whisper-1") via the env when needed.
const TRANSCRIPTION_MODEL = process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL ?? "gpt-4o-transcribe";
const CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

// ── Realtime data-channel wire protocol ──────────────────────────────────────
// The OpenAI Realtime API namespaces the same logical event under several type
// prefixes across model lines (e.g. `conversation.item.input_audio_transcription
// .completed`, `response.output_audio_transcript.delta`). We match on the stable
// suffix/substring rather than the full string. These live here, beside the
// OpenAI adapter, so the wire contract is documented next to the rest of the
// OpenAI integration instead of buried as magic substrings in the UI component —
// a silent typo here would just drop the transcript turns that feed the scorecard.
const OAI_EVENT_SUFFIX = {
  // Final transcription of a candidate (input audio) utterance — carries `transcript`.
  inputTranscriptionCompleted: "input_audio_transcription.completed",
  // Streaming chunk of a candidate utterance's transcription — carries `delta`.
  // whisper-1 only emits the final .completed; newer transcription models
  // stream deltas, so both are tracked (idea-b70b8bd7).
  inputTranscriptionDelta: "input_audio_transcription.delta",
  // Server VAD heard the candidate start speaking — an utterance is now PENDING
  // until its transcription completes. Finalize uses this to know a last answer
  // is still in flight on hang-up (idea-b70b8bd7).
  inputSpeechStarted: "input_audio_buffer.speech_started",
  // Streaming chunk of the assistant's spoken-response transcript — carries `delta`.
  outputTranscriptDelta: "output_audio_transcript.delta",
  // The assistant's spoken-response transcript is complete.
  outputTranscriptDone: "output_audio_transcript.done",
} as const;

// The transcript action a realtime event implies, normalized for the UI so the
// component never re-derives it from raw event-type strings.
export type OaiTranscriptEvent =
  | { kind: "candidateUtterance"; text: string }
  | { kind: "candidateDelta"; text: string }
  | { kind: "candidateSpeechStarted" }
  | { kind: "assistantDelta"; text: string }
  | { kind: "assistantDone" };

/** Parse a raw OpenAI Realtime data-channel event into the transcript action it
 *  implies, or `null` when it isn't a transcript event we track. Matching is by
 *  suffix/substring (see OAI_EVENT_SUFFIX) and guards the payload fields, so a
 *  malformed event is ignored rather than pushed as an empty turn. */
export function parseOaiTranscriptEvent(ev: Record<string, unknown>): OaiTranscriptEvent | null {
  const type = String(ev.type ?? "");
  if (type.endsWith(OAI_EVENT_SUFFIX.inputTranscriptionCompleted) && typeof ev.transcript === "string") {
    return { kind: "candidateUtterance", text: ev.transcript };
  }
  if (type.includes(OAI_EVENT_SUFFIX.inputTranscriptionDelta) && typeof ev.delta === "string") {
    return { kind: "candidateDelta", text: ev.delta };
  }
  if (type.endsWith(OAI_EVENT_SUFFIX.inputSpeechStarted)) {
    return { kind: "candidateSpeechStarted" };
  }
  if (type.includes(OAI_EVENT_SUFFIX.outputTranscriptDelta) && typeof ev.delta === "string") {
    return { kind: "assistantDelta", text: ev.delta };
  }
  if (type.includes(OAI_EVENT_SUFFIX.outputTranscriptDone)) {
    return { kind: "assistantDone" };
  }
  return null;
}

type SecretResponse = {
  value?: string;
  expires_at?: number;
  client_secret?: { value?: string } | string;
};

/** Normalize a coerceLanguage()-validated hint ("cs", "en", "en-US", …) to the
 *  ISO-639-1 primary subtag the Realtime transcription config wants ("cs", "en").
 *  Returns null for an absent/unknown hint so the caller omits the field entirely
 *  and preserves the pre-existing bilingual-open behavior byte-for-byte. Only
 *  well-formed two-letter primary subtags pass; anything else → null (the
 *  transcription model then auto-detects, as before). */
export function normalizeTranscriptionLanguage(language?: string | null): string | null {
  if (typeof language !== "string") return null;
  const primary = language.split("-")[0]?.toLowerCase() ?? "";
  return /^[a-z]{2}$/.test(primary) ? primary : null;
}

/** Build the OpenAI Realtime client_secrets session payload. Pure and exported so
 *  the language-parity behavior (idea: language enforcement parity for OpenAI) is
 *  unit-testable without a network call. When the candidate locale is known it
 *  sets input-audio transcription `language` — the voice harness showed
 *  prompt-level language locks lose to transport config, so Czech speech was
 *  transcribing against an English default (the ElevenLabs path already pins
 *  language client-side; this closes the OpenAI gap). Unknown/absent locale →
 *  no language field, identical to the prior bilingual-open payload. */
export function buildOpenAiSessionPayload(opts: {
  model: string;
  instructions: string;
  transcriptionModel: string;
  voice: string;
  language?: string | null;
}): { session: Record<string, unknown> } {
  const transcription: { model: string; language?: string } = { model: opts.transcriptionModel };
  const lang = normalizeTranscriptionLanguage(opts.language);
  if (lang) transcription.language = lang;
  return {
    session: {
      type: "realtime",
      model: opts.model,
      instructions: opts.instructions,
      audio: {
        input: { transcription },
        output: { voice: opts.voice },
      },
    },
  };
}

export class OpenAiVoiceAdapter implements VoiceAdapter {
  readonly id = "openai" as const;
  readonly requiredEnv = ["OPENAI_API_KEY"] as const;

  available(): boolean {
    return missingVoiceEnv(this).length === 0;
  }

  async connect({ instructions, language }: { instructions: string; language?: string | null }): Promise<OpenAiConnect> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    const model = openAiRealtimeModel();

    const res = await fetch(SECRETS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // Pin transcription language to the candidate's locale when known — a
      // prompt-level lock alone loses to the transport default (the ElevenLabs
      // path pins it client-side for the same reason). Unknown locale → payload
      // unchanged from the bilingual-open default.
      body: JSON.stringify(
        buildOpenAiSessionPayload({ model, instructions, transcriptionModel: TRANSCRIPTION_MODEL, voice: VOICE, language }),
      ),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI client_secrets ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as SecretResponse;
    const clientSecret =
      data.value ?? (typeof data.client_secret === "string" ? data.client_secret : data.client_secret?.value);
    if (!clientSecret) throw new Error("OpenAI did not return a client secret");

    return { provider: "openai", model, clientSecret, callsUrl: CALLS_URL };
  }
}
