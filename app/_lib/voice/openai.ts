import type { OpenAiConnect, VoiceAdapter } from "./types";

// OpenAI Realtime (gpt-realtime, GA). Browser uses WebRTC; the server mints an
// ephemeral client secret via /v1/realtime/client_secrets and the browser POSTs
// its SDP offer to /v1/realtime/calls. Model/voice are env-overridable because
// the realtime model line moves quickly.

const MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
const VOICE = process.env.OPENAI_REALTIME_VOICE ?? "marin";
const CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";

type SecretResponse = {
  value?: string;
  expires_at?: number;
  client_secret?: { value?: string } | string;
};

export class OpenAiVoiceAdapter implements VoiceAdapter {
  readonly id = "openai" as const;

  available(): boolean {
    return Boolean(process.env.OPENAI_API_KEY);
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
            input: { transcription: { model: "whisper-1" } },
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
