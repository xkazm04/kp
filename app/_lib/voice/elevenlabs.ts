import { elevenLabsBaseUrl } from "./self-hosted.ts";
import { missingVoiceEnv, type ElevenLabsConnect, type VoiceAdapter } from "./types.ts";

// ElevenLabs Agents (Conversational AI). The agent itself — prompt, voice,
// language(s) — is configured in the ElevenLabs dashboard; create one with a
// multilingual model and a Czech-capable voice, then set ELEVENLABS_AGENT_ID.
// The server mints a short-lived signed URL; the browser connects with the
// @elevenlabs/react SDK.
//
// The host is resolved rather than hardcoded so the same code path can talk to
// a voice service you run yourself (ELEVENLABS_BASE_URL — see self-hosted.ts).
// Everything downstream is unchanged: the browser connects to whatever signed
// URL the server returns, so a local ws:// endpoint needs no client change.

const signedUrlEndpoint = () =>
  `${elevenLabsBaseUrl()}/v1/convai/conversation/get-signed-url`;

/** Timeout for the signed-URL mint. The candidate is watching a 30s connect
 *  latch in the browser, so a mint still unanswered at 15s has already lost the
 *  call. It matters most on the SELF-HOSTED path (ELEVENLABS_BASE_URL): a local
 *  voice service that is up but wedged accepts the socket and never replies, and
 *  an unbounded fetch then held the route open long after the browser's latch had
 *  fired — with the session already flipped in_progress by markInterviewStarted. */
export const ELEVENLABS_MINT_TIMEOUT_MS = 15_000;

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

    const endpoint = signedUrlEndpoint();
    const res = await fetch(`${endpoint}?agent_id=${encodeURIComponent(agentId)}`, {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(ELEVENLABS_MINT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // Name the host: with ELEVENLABS_BASE_URL in play, "get-signed-url 404"
      // is otherwise indistinguishable between a dead local service and a real
      // ElevenLabs error.
      throw new Error(`${endpoint} responded ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = (await res.json()) as { signed_url?: string };
    if (!data.signed_url) throw new Error("ElevenLabs did not return a signed_url");

    return { provider: "elevenlabs", signedUrl: data.signed_url };
  }
}
