// Cloud adapter: the hosted text-to-speech REST endpoint. Whole-clip, returned
// as raw PCM and wrapped into WAV here — the same container the local engines
// produce, so a by-ear comparison measures the voice, not the codec (an MP3
// against a WAV is identifiable by listeners and biases the compare). The
// streaming endpoints exist; a streaming host segments and calls per chunk.
// Credentials come through the host, never from process.env directly.
import { pcmToWav } from "../node/wav.ts";
import { TtsError, type TtsAudio, type TtsHost, type TtsProbe, type TtsProvider, type TtsRequest, type TtsVoice } from "../types.ts";

const HOSTED_BASE_URL = "https://api.elevenlabs.io";
/** A stock multilingual voice so a fresh key speaks without a voice pick. */
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_MODEL = "eleven_flash_v2_5";
const PROBE_TTL_MS = 60_000;
const TIMEOUT_MS = 30_000;
const PCM_RATE = 24_000;

export class ElevenLabsTts implements TtsProvider {
  readonly id = "elevenlabs" as const;
  readonly label = "ElevenLabs";
  readonly kind = "cloud" as const;
  readonly requiredEnv = ["ELEVENLABS_API_KEY"] as const;
  readonly capabilities = { streaming: false, languages: "any", speed: true, onDevice: false, maxClipChars: 1200 } as const;

  private probeCache: { at: number; probe: TtsProbe } | null = null;

  constructor(private readonly host: TtsHost) {}

  private baseUrl(): string {
    return (this.host.env("ELEVENLABS_BASE_URL") || HOSTED_BASE_URL).replace(/\/+$/, "");
  }
  private apiKey(): string | undefined {
    return this.host.env("ELEVENLABS_API_KEY")?.trim() || undefined;
  }

  async probe(): Promise<TtsProbe> {
    const key = this.apiKey();
    if (!key) return { state: "absent", reason: "ELEVENLABS_API_KEY is not set", setup: "Paste an API key (Settings or .env.local)." };
    if (this.probeCache && Date.now() - this.probeCache.at < PROBE_TTL_MS) return this.probeCache.probe;
    const started = Date.now();
    let probe: TtsProbe;
    try {
      const res = await fetch(`${this.baseUrl()}/v1/user`, {
        headers: { "xi-api-key": key },
        signal: AbortSignal.timeout(8_000),
      });
      probe = res.ok
        ? { state: "ready" }
        : res.status === 401
          ? { state: "broken", reason: "the API key was rejected (401)" }
          : { state: "broken", reason: `the service answered ${res.status}` };
    } catch (err) {
      probe = { state: "broken", reason: `unreachable: ${(err as Error).message}` };
    }
    this.probeCache = { at: Date.now(), probe };
    this.host.log?.({ type: "probe", provider: this.id, probe, ms: Date.now() - started });
    return probe;
  }

  async voices(): Promise<TtsVoice[]> {
    const key = this.apiKey();
    if (!key) return [];
    try {
      const res = await fetch(`${this.baseUrl()}/v1/voices`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return [];
      const json = (await res.json()) as { voices?: { voice_id: string; name: string; labels?: { language?: string } }[] };
      return (json.voices ?? []).slice(0, 50).map((v) => ({ id: v.voice_id, label: v.name, language: v.labels?.language ?? null }));
    } catch {
      return [];
    }
  }

  async synthesize(req: TtsRequest, signal?: AbortSignal): Promise<TtsAudio> {
    const key = this.apiKey();
    if (!key) throw new TtsError("unavailable", "ELEVENLABS_API_KEY is not set", this.id);
    const voiceId = req.voiceId || this.host.env("ELEVENLABS_VOICE_ID")?.trim() || DEFAULT_VOICE_ID;
    const model = this.host.env("ELEVENLABS_TTS_MODEL")?.trim() || DEFAULT_MODEL;
    const started = Date.now();
    const body: Record<string, unknown> = { text: req.text, model_id: model };
    if (req.language) body.language_code = req.language.split("-")[0];
    if (req.speed && req.speed !== 1) body.voice_settings = { speed: req.speed };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_${PCM_RATE}`, {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/pcm" },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === "AbortError") throw new TtsError("aborted", "synthesis aborted", this.id);
      if (e.name === "TimeoutError") throw new TtsError("timeout", `no audio within ${TIMEOUT_MS}ms`, this.id);
      throw new TtsError("engine_failed", `unreachable: ${e.message}`, this.id);
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      // A positive probe is cached for a minute; a real failure invalidates it
      // (quota can run out mid-minute), but a 429 is "busy", not "down".
      if (res.status !== 429) this.probeCache = null;
      this.host.log?.({ type: "error", provider: this.id, message: `${res.status} ${detail}` });
      throw new TtsError(res.status === 401 ? "unavailable" : "engine_failed", `service answered ${res.status}`, this.id);
    }
    const bytes = pcmToWav(new Uint8Array(await res.arrayBuffer()), PCM_RATE);
    const elapsedMs = Date.now() - started;
    this.host.log?.({ type: "synthesize", provider: this.id, voiceId, chars: req.text.length, ms: elapsedMs, bytes: bytes.length });
    return { bytes, mimeType: "audio/wav", provider: this.id, voiceId, elapsedMs };
  }
}
