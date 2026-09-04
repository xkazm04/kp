import { createHash } from "node:crypto";
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
  client_secret?: { value?: string; expires_at?: number } | string;
};

/** How long a minted browser credential stays valid, in seconds, requested
 *  explicitly via `expires_after` rather than left to the provider's default.
 *
 *  The secret is handed to the CANDIDATE'S BROWSER over the public token route
 *  and is the one artifact in this flow that can spend money directly at the
 *  provider (a leaked one dials `/v1/realtime/calls` with no involvement from
 *  us — only the per-token connect throttle stood between it and a free call).
 *  Its lifetime therefore has to be OURS to state, and it only has to cover the
 *  gap between the mint and the SDP exchange: the browser POSTs its offer within
 *  seconds of receiving it, and once the WebRTC call is established the secret is
 *  no longer used. Two minutes is generous for a slow mobile handshake and a
 *  permission prompt (the client's own connect latch gives up at 30s) while
 *  cutting a stolen credential's usable window from the provider's default to
 *  about the length of one dial. */
export const OPENAI_SECRET_TTL_SEC = 120;

/** Timeout for the server→OpenAI mint. The candidate is staring at "Connecting…"
 *  with a 30s client latch behind it, so a mint that has not answered in 15s has
 *  already lost the call; without this the fetch could hang until the platform's
 *  own socket timeout with the browser latch long since fired, leaving a session
 *  flipped `in_progress` by a request nobody is waiting on any more. */
export const OPENAI_MINT_TIMEOUT_MS = 15_000;

/** The session-bound fingerprint that rides in the provider session's metadata.
 *  A truncated SHA-256 of the capability token — never the token itself, which is
 *  the credential to the whole interview and must not be handed to a third party
 *  or written into their logs. It binds a minted secret to ONE interview session,
 *  so a credential seen in a provider dashboard or a support thread is traceable
 *  to the session it belongs to (and a secret minted for another session is
 *  identifiable as such) without exposing anything that grants access. */
export function interviewSessionFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 32);
}

/** Whether a mint response's `expires_at` (unix SECONDS) describes a credential
 *  that is still usable. Absent is a failure, not a pass: `expires_at` was parsed
 *  into the response type and then read by nobody, so a provider response that
 *  stopped carrying it — or a proxy that stripped it — would have handed the
 *  browser a credential of unknown, possibly unbounded, lifetime and nothing here
 *  would have noticed. `now` is injectable so the check is unit-testable. */
export function isMintedSecretUsable(expiresAt: unknown, now: number = Date.now()): boolean {
  return typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt * 1000 > now;
}

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
  // RELAY mode (docs/architecture/voice-conversation-plane.md): the provider is
  // ONLY the speech transport — server VAD still segments utterances and
  // transcribes them, but the model must NEVER answer on its own
  // (create_response: false); replies are injected explicitly by the client via
  // response.create with the exact text OUR engine produced. This is what keeps
  // the conversational brain vendor-neutral.
  relay?: boolean;
  /** The interview session's capability token. Only its FINGERPRINT is sent (see
   *  interviewSessionFingerprint) — the token itself never leaves this server. */
  sessionToken?: string | null;
  /** Requested credential lifetime in seconds. Omitted ⇒ the field is absent and
   *  the provider's default applies, which is the shape the `metadata`-rejected
   *  retry in connect() falls back to. */
  expiresAfterSec?: number | null;
}): { session: Record<string, unknown>; expires_after?: { anchor: string; seconds: number } } {
  const transcription: { model: string; language?: string } = { model: opts.transcriptionModel };
  const lang = normalizeTranscriptionLanguage(opts.language);
  if (lang) transcription.language = lang;
  const input: Record<string, unknown> = { transcription };
  if (opts.relay) {
    input.turn_detection = { type: "server_vad", create_response: false, interrupt_response: true };
  }
  const session: Record<string, unknown> = {
    type: "realtime",
    model: opts.model,
    instructions: opts.instructions,
    audio: {
      input,
      output: { voice: opts.voice },
    },
  };
  // Bind the minted credential to ONE interview session. The value is a hash, so
  // this is an identifier we can recognize, not a capability anyone can replay.
  if (opts.sessionToken) {
    session.metadata = { kp_session: interviewSessionFingerprint(opts.sessionToken) };
  }
  const payload: { session: Record<string, unknown>; expires_after?: { anchor: string; seconds: number } } = { session };
  // State the lifetime instead of inheriting whatever the provider defaults to —
  // this secret goes to the candidate's browser and can spend money on its own.
  if (typeof opts.expiresAfterSec === "number" && opts.expiresAfterSec > 0) {
    payload.expires_after = { anchor: "created_at", seconds: opts.expiresAfterSec };
  }
  return payload;
}

export class OpenAiVoiceAdapter implements VoiceAdapter {
  readonly id = "openai" as const;
  readonly requiredEnv = ["OPENAI_API_KEY"] as const;

  available(): boolean {
    return missingVoiceEnv(this).length === 0;
  }

  async connect({
    instructions,
    language,
    relay,
    sessionToken,
  }: {
    instructions: string;
    language?: string | null;
    relay?: boolean;
    sessionToken?: string | null;
  }): Promise<OpenAiConnect> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    const model = openAiRealtimeModel();

    const mint = (withMetadata: boolean) =>
      fetch(SECRETS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        // Pin transcription language to the candidate's locale when known — a
        // prompt-level lock alone loses to the transport default (the ElevenLabs
        // path pins it client-side for the same reason). Unknown locale → payload
        // unchanged from the bilingual-open default.
        body: JSON.stringify(
          buildOpenAiSessionPayload({
            model,
            instructions,
            transcriptionModel: TRANSCRIPTION_MODEL,
            voice: VOICE,
            language,
            relay,
            sessionToken: withMetadata ? sessionToken : null,
            expiresAfterSec: OPENAI_SECRET_TTL_SEC,
          })
        ),
        // The candidate is watching a 30s connect latch: a mint that has not
        // answered well inside it has already lost the call, and an unbounded
        // fetch would leave the session flipped in_progress by a request nobody
        // is waiting on. AbortError surfaces as a plain fetch rejection, which
        // the route already answers as INTERVIEW_CONNECT_FAILED.
        signal: AbortSignal.timeout(OPENAI_MINT_TIMEOUT_MS),
      });

    let res = await mint(!!sessionToken);
    if (!res.ok && sessionToken) {
      const detail = await res.text().catch(() => "");
      // `metadata` on a realtime session is the ONE field here we cannot verify
      // against a keyless install, and it is an audit convenience — never worth
      // failing a candidate's interview over. If the provider rejects the
      // request BECAUSE of it, retry once without it and say so on the console
      // for the operator; every other failure keeps its original body.
      if (res.status === 400 && /metadata/i.test(detail)) {
        console.warn(
          "[voice] OpenAI client_secrets rejected session metadata — retrying the mint without the " +
            "session fingerprint (credential binding is unavailable on this API version)."
        );
        res = await mint(false);
      } else {
        throw new Error(`OpenAI client_secrets ${res.status}: ${detail.slice(0, 300)}`);
      }
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI client_secrets ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = (await res.json()) as SecretResponse;
    const clientSecret =
      data.value ?? (typeof data.client_secret === "string" ? data.client_secret : data.client_secret?.value);
    if (!clientSecret) throw new Error("OpenAI did not return a client secret");
    // `expires_at` was parsed into SecretResponse and read by nobody: we asked for
    // no lifetime and enforced none, so a credential the provider had already
    // expired (clock skew, a retried mint, a cached proxy response) was handed to
    // the browser and only failed at the SDP exchange — where it looks exactly
    // like a network fault. Refuse it here instead, where the failure is nameable.
    const expiresAt =
      data.expires_at ?? (typeof data.client_secret === "object" ? data.client_secret?.expires_at : undefined);
    if (!isMintedSecretUsable(expiresAt)) {
      throw new Error(
        `OpenAI returned a client secret with no usable expiry (expires_at=${String(expiresAt)}); refusing to hand it to the browser`
      );
    }

    return { provider: "openai", model, clientSecret, callsUrl: CALLS_URL };
  }
}
