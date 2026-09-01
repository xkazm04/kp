// Cloud adapter: AssemblyAI async transcription (upload -> submit -> poll).
//
// Why this vendor sits in the commercial layer next to ElevenLabs rather than
// opposite it: ElevenLabs is the OUTPUT direction (and the duplex agent), this
// is the INPUT one. They are not alternatives to each other, and an operator
// picking between them is answering two different questions.
//
// Three facts an operator has to be told, so they are written here and in
// docs/architecture/voice-stt-package.md rather than discovered in a bill:
//   1. LANGUAGE. This adapter is the ASYNC path, whose catalog is wide (Czech
//      included). The vendor's real-time multilingual model is en/es/fr/de/it/pt
//      only — no Czech — which is why the streaming transport is NOT quietly
//      wired in behind the same id.
//   2. RESIDENCY. The audio leaves the machine. `ASSEMBLYAI_BASE_URL` selects a
//      data zone (the EU one keeps audio and transcripts in the EU) and the
//      package's on-device engine exists so that not sending it at all stays a
//      real option — see SttNeeds.onDevice.
//   3. MONEY. Every call is billed per audio hour, and redaction/diarization are
//      priced add-ons. The host route throttles; this adapter never retries a
//      submission on its own, because a retry here is a second charge.
import { wavInfo } from "../node/wav.ts";
import {
  SttError,
  type SttHost,
  type SttModel,
  type SttProbe,
  type SttProvider,
  type SttRequest,
  type SttSegment,
  type SttTranscript,
} from "../types.ts";

const HOSTED_BASE_URL = "https://api.assemblyai.com";
const PROBE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 30_000;
/** Whole-job budget: upload + submit + poll to a terminal status. */
const JOB_TIMEOUT_MS = 300_000;
const POLL_MIN_MS = 1_000;
const POLL_MAX_MS = 5_000;
/** Not verified against a live key — the vendor owns this vocabulary and adds to
 *  it. A rejected policy comes back as a 400 whose body this adapter surfaces
 *  verbatim, and `ASSEMBLYAI_PII_POLICIES` overrides the list without a code change. */
const DEFAULT_PII_POLICIES = ["person_name", "phone_number", "email_address", "location"];

type TranscriptRow = {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  text?: string | null;
  error?: string | null;
  audio_duration?: number | null;
  language_code?: string | null;
  speech_model?: string | null;
  utterances?: { start: number; end: number; text: string; speaker?: string | null; confidence?: number | null }[] | null;
};

export class AssemblyAiStt implements SttProvider {
  readonly id = "assemblyai" as const;
  readonly label = "AssemblyAI";
  readonly kind = "cloud" as const;
  readonly requiredEnv = ["ASSEMBLYAI_API_KEY"] as const;
  readonly capabilities = {
    streaming: false,
    // The async catalog is wide enough that enumerating it here would go stale
    // within a release; the service answers for itself per request.
    languages: "any",
    onDevice: false,
    diarization: true,
    redaction: true,
    maxClipSeconds: 4 * 3600,
    maxBytes: 25 * 1024 * 1024,
  } as const;

  private probeCache: { at: number; probe: SttProbe } | null = null;

  constructor(private readonly host: SttHost) {}

  private baseUrl(): string {
    return (this.host.env("ASSEMBLYAI_BASE_URL") || HOSTED_BASE_URL).replace(/\/+$/, "");
  }
  private apiKey(): string | undefined {
    return this.host.env("ASSEMBLYAI_API_KEY")?.trim() || undefined;
  }
  private headers(key: string): Record<string, string> {
    return { authorization: key };
  }

  async probe(): Promise<SttProbe> {
    const key = this.apiKey();
    if (!key) {
      return { state: "absent", reason: "ASSEMBLYAI_API_KEY is not set", setup: "Paste an AssemblyAI API key (Settings or .env.local)." };
    }
    if (this.probeCache && Date.now() - this.probeCache.at < PROBE_TTL_MS) return this.probeCache.probe;
    const started = Date.now();
    let probe: SttProbe;
    try {
      // A list read: cheapest call that proves the key is accepted, and it
      // transcribes nothing, so a probe never appears on a bill.
      const res = await fetch(`${this.baseUrl()}/v2/transcript?limit=1`, {
        headers: this.headers(key),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      probe = res.ok
        ? { state: "ready", detail: new URL(this.baseUrl()).host }
        : res.status === 401 || res.status === 403
          ? { state: "broken", reason: "the API key was rejected" }
          : { state: "broken", reason: `the service answered ${res.status}` };
    } catch (err) {
      probe = { state: "broken", reason: `unreachable: ${(err as Error).message}` };
    }
    this.probeCache = { at: Date.now(), probe };
    this.host.log?.({ type: "probe", provider: this.id, probe, ms: Date.now() - started });
    return probe;
  }

  /** The vendor's model tiers are an account-level vocabulary, not something
   *  this install can enumerate; the configured one is the only honest answer. */
  async models(): Promise<SttModel[]> {
    const configured = this.host.env("ASSEMBLYAI_MODEL")?.trim();
    return configured ? [{ id: configured, label: configured, language: null }] : [];
  }

  private async call(path: string, key: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl()}${path}`, {
        ...init,
        headers: { ...this.headers(key), ...(init.headers as Record<string, string> | undefined) },
        signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const e = err as Error;
      if (e.name === "AbortError") throw new SttError("aborted", "transcription aborted", this.id);
      if (e.name === "TimeoutError") throw new SttError("timeout", `no answer within ${init.timeoutMs ?? REQUEST_TIMEOUT_MS}ms`, this.id);
      throw new SttError("engine_failed", `unreachable: ${e.message}`, this.id);
    }
  }

  private async refuse(res: Response, what: string): Promise<never> {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    // A cached positive probe is invalidated by a real failure (a key can be
    // revoked or a quota exhausted mid-minute), but a 429 is "busy", not "down".
    if (res.status !== 429) this.probeCache = null;
    this.host.log?.({ type: "error", provider: this.id, message: `${what}: ${res.status} ${detail}` });
    throw new SttError(
      res.status === 401 || res.status === 403 ? "unavailable" : "engine_failed",
      `${what} answered ${res.status}${detail ? `: ${detail}` : ""}`,
      this.id,
    );
  }

  async transcribe(req: SttRequest, signal?: AbortSignal): Promise<SttTranscript> {
    const key = this.apiKey();
    if (!key) throw new SttError("unavailable", "ASSEMBLYAI_API_KEY is not set", this.id);
    const started = Date.now();
    const deadline = started + JOB_TIMEOUT_MS;
    const withSignal = (timeoutMs: number) =>
      signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);

    // 1. Upload. The bytes go up as-is: the vendor decodes every container the
    //    validation door admits, so there is nothing to transcode here.
    const up = await this.call("/v2/upload", key, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: req.audio as BodyInit,
      signal: withSignal(REQUEST_TIMEOUT_MS * 2),
    });
    if (!up.ok) await this.refuse(up, "upload");
    const { upload_url: audioUrl } = (await up.json()) as { upload_url?: string };
    if (!audioUrl) throw new SttError("engine_failed", "upload returned no url", this.id);

    // 2. Submit.
    const model = req.modelId || this.host.env("ASSEMBLYAI_MODEL")?.trim() || null;
    const body: Record<string, unknown> = { audio_url: audioUrl };
    if (req.language) body.language_code = req.language;
    else body.language_detection = true;
    if (model) body.speech_model = model;
    if (req.diarize) body.speaker_labels = true;
    if (req.redactPii) {
      body.redact_pii = true;
      const configured = (this.host.env("ASSEMBLYAI_PII_POLICIES") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      body.redact_pii_policies = configured.length ? configured : DEFAULT_PII_POLICIES;
      // entity_name over a hash: a redacted hiring transcript still has to be
      // readable by the person reviewing it — "[PERSON_NAME] mentioned Kafka"
      // is evidence, a row of hashes is not.
      body.redact_pii_sub = this.host.env("ASSEMBLYAI_PII_SUB")?.trim() || "entity_name";
    }
    const submit = await this.call("/v2/transcript", key, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: withSignal(REQUEST_TIMEOUT_MS),
    });
    if (!submit.ok) await this.refuse(submit, "submit");
    let row = (await submit.json()) as TranscriptRow;

    // 3. Poll to a terminal status. No re-submission on failure: a retry here is
    //    a second charge for the same audio, and that is the host's call to make.
    let waitMs = POLL_MIN_MS;
    while (row.status !== "completed" && row.status !== "error") {
      if (Date.now() > deadline) throw new SttError("timeout", `transcript ${row.id} unfinished after ${JOB_TIMEOUT_MS}ms`, this.id);
      await sleep(waitMs, signal);
      waitMs = Math.min(POLL_MAX_MS, Math.round(waitMs * 1.5));
      const poll = await this.call(`/v2/transcript/${encodeURIComponent(row.id)}`, key, { signal: withSignal(REQUEST_TIMEOUT_MS) });
      if (!poll.ok) await this.refuse(poll, "poll");
      row = (await poll.json()) as TranscriptRow;
    }
    if (row.status === "error") {
      this.host.log?.({ type: "error", provider: this.id, message: row.error ?? "unknown" });
      throw new SttError("engine_failed", row.error || "the service reported an error", this.id);
    }

    const text = (row.text ?? "").trim();
    const segments: SttSegment[] = (row.utterances ?? []).map((u) => ({
      start: u.start / 1000,
      end: u.end / 1000,
      text: u.text,
      speaker: u.speaker ?? null,
      confidence: typeof u.confidence === "number" ? u.confidence : null,
    }));
    const durationMs =
      typeof row.audio_duration === "number" ? Math.round(row.audio_duration * 1000) : (wavInfo(req.audio)?.durationMs ?? null);
    const elapsedMs = Date.now() - started;
    this.host.log?.({ type: "transcribe", provider: this.id, modelId: model, bytes: req.audio.byteLength, ms: elapsedMs, chars: text.length });
    return {
      text,
      // One segment covering the clip when the engine returned no turn structure —
      // an empty segment list would read as "nothing was said".
      segments: segments.length || !text ? segments : [{ start: 0, end: (durationMs ?? 0) / 1000, text, speaker: null, confidence: null }],
      language: row.language_code ?? req.language ?? null,
      provider: this.id,
      modelId: row.speech_model ?? model,
      elapsedMs,
      durationMs,
      // What the engine DID, read back off the row — never an echo of the ask.
      diarized: (row.utterances?.length ?? 0) > 0,
      redacted: req.redactPii === true,
    };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new SttError("aborted", "transcription aborted", "assemblyai"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new SttError("aborted", "transcription aborted", "assemblyai"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
