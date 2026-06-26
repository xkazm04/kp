import { missingVoiceEnv, type OpenAiConnect, type VoiceAdapter } from "./types.ts";

// OpenAI Realtime (gpt-realtime, GA). Browser uses WebRTC; the server mints an
// ephemeral client secret via /v1/realtime/client_secrets and the browser POSTs
// its SDP offer to /v1/realtime/calls. Model/voice/transcription are env-overridable
// because the realtime model line moves quickly.

const MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
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

export class OpenAiVoiceAdapter implements VoiceAdapter {
  readonly id = "openai" as const;
  readonly requiredEnv = ["OPENAI_API_KEY"] as const;

  available(): boolean {
    return missingVoiceEnv(this).length === 0;
  }

  async connect({ instructions }: { instructions: string; language?: string | null }): Promise<OpenAiConnect> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");

    const res = await fetch(SECRETS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: MODEL,
          instructions,
          audio: {
            input: { transcription: { model: TRANSCRIPTION_MODEL } },
            output: { voice: VOICE },
          },
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI client_secrets ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as SecretResponse;
    const clientSecret =
      data.value ?? (typeof data.client_secret === "string" ? data.client_secret : data.client_secret?.value);
    if (!clientSecret) throw new Error("OpenAI did not return a client secret");

    return { provider: "openai", model: MODEL, clientSecret, callsUrl: CALLS_URL };
  }
}
