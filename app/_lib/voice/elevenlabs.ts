import { missingVoiceEnv, type ElevenLabsConnect, type VoiceAdapter } from "./types.ts";

// ElevenLabs Agents (Conversational AI). The agent itself — prompt, voice,
// language(s) — is configured in the ElevenLabs dashboard; create one with a
// multilingual model and a Czech-capable voice, then set ELEVENLABS_AGENT_ID.
// The server mints a short-lived signed URL; the browser connects with the
// @elevenlabs/react SDK.

const SIGNED_URL = "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url";

export class ElevenLabsVoiceAdapter implements VoiceAdapter {
  readonly id = "elevenlabs" as const;
  readonly requiredEnv = ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID"] as const;

  available(): boolean {
    return missingVoiceEnv(this).length === 0;
  }

  async connect(): Promise<ElevenLabsConnect> {
    const key = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    if (!key || !agentId) throw new Error("ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID must be set");

    const res = await fetch(`${SIGNED_URL}?agent_id=${encodeURIComponent(agentId)}`, {
      headers: { "xi-api-key": key },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`ElevenLabs get-signed-url ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as { signed_url?: string };
    if (!data.signed_url) throw new Error("ElevenLabs did not return a signed_url");

    return { provider: "elevenlabs", signedUrl: data.signed_url };
  }
}
