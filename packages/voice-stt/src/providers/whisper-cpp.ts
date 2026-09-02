// Local adapter: whisper.cpp (GGML, CPU, offline, multilingual — Czech included).
// One process per clip: WAV in, JSON out (`-oj`), nothing on the network.
//
// This is the adapter that makes on-device the DEFAULT rather than the
// aspiration, which is the whole reason the input direction gets its own
// package. A first-round interview is a person talking about their life in
// their own room; the defensible posture is that those bytes stay on the
// machine unless somebody explicitly chose otherwise, and choosing otherwise is
// what the cloud adapter and `KP_STT_PROVIDERS` are for.
//
// Two honest limits, both surfaced as typed refusals rather than worked around:
// whisper.cpp reads 16 kHz PCM WAV and nothing else (this package does not
// transcode — see node/wav.ts), and an English-only model (`ggml-*.en.bin`)
// cannot be asked for Czech no matter what the family can do.
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { resolveBinary, sidecarHome } from "../node/resolve-bin.ts";
import { readJson, runSidecar, withScratchDir, writeAudio } from "../node/spawn.ts";
import { wavInfo } from "../node/wav.ts";
import { primaryLanguage } from "../validate.ts";
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

const DEFAULT_TIMEOUT_MS = 300_000;
/** Same TTL the cloud adapter uses, for the same reason and against a different
 *  cost: there the probe is a network round trip, here it is a readdir plus a
 *  stat per model directory on EVERY resolve — and resolve runs ahead of every
 *  transcribe and every status read. A minute of staleness is the right price:
 *  installing an engine is a deliberate act somebody can wait a moment to see,
 *  and a real failure invalidates the cache immediately (see transcribe). */
const PROBE_TTL_MS = 60_000;
const REQUIRED_SAMPLE_RATE = 16_000;
/** A GGML model smaller than this is a truncated download, not a small model —
 *  the tiny quantized builds start around 30 MB. */
const MIN_MODEL_BYTES = 20 * 1024 * 1024;
const INSTALL_HINT =
  "Install whisper.cpp (github.com/ggml-org/whisper.cpp) so `whisper-cli` is on PATH or in <VOICE_SIDECAR_HOME>/bin, then fetch a model into data/whisper (e.g. ggml-base.bin). Overrides: WHISPER_BIN, WHISPER_MODEL_DIR, WHISPER_MODEL.";

type WhisperModel = SttModel & { file: string };

/** whisper.cpp's `-oj` document, narrowed to what a transcript needs. */
type WhisperJson = {
  result?: { language?: string | null };
  transcription?: { offsets?: { from?: number; to?: number }; text?: string }[];
};

export class WhisperCppStt implements SttProvider {
  readonly id = "whisper_cpp" as const;
  readonly label = "Whisper.cpp (local)";
  readonly kind = "local" as const;
  readonly requiredEnv = ["WHISPER_BIN", "WHISPER_MODEL_DIR", "WHISPER_MODEL"] as const;
  readonly capabilities = {
    streaming: false,
    // The multilingual GGML models cover ~99 languages; which of them THIS
    // install can serve depends on the model file present, and transcribe()
    // refuses the mismatch by name rather than guessing.
    languages: "any",
    onDevice: true,
    diarization: false,
    redaction: false,
    maxClipSeconds: 3600,
    maxBytes: 25 * 1024 * 1024,
  } as const;

  private probeCache: { at: number; probe: SttProbe } | null = null;

  constructor(private readonly host: SttHost) {}

  /** Drop a cached probe because the engine just failed for real. Mirrors the
   *  cloud adapter's rule: a positive probe a minute old is worthless once the
   *  binary or the model has proved unusable. */
  private invalidateProbe(): void {
    this.probeCache = null;
  }

  private binary(): string | null {
    // `main` is the pre-rename CLI; an engine installed under the old name is
    // an installed engine, and a probe that calls it absent sends the operator
    // to re-download something they already have.
    return resolveBinary(this.host, { envVar: "WHISPER_BIN", names: ["whisper-cli", "main"] });
  }

  private timeoutMs(): number {
    const raw = Number(this.host.env("WHISPER_TIMEOUT_MS"));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
  }

  private modelDirs(): string[] {
    return [
      ...new Set([
        this.host.env("WHISPER_MODEL_DIR") || path.join(this.host.cwd(), "data", "whisper"),
        path.join(sidecarHome(this.host), "whisper"),
      ]),
    ];
  }

  /** Every ggml-*.bin one level down, plus an explicitly pointed-at file. */
  private async catalog(): Promise<WhisperModel[]> {
    const out: WhisperModel[] = [];
    const add = (file: string) => {
      const id = path.basename(file).replace(/\.bin$/i, "");
      if (out.some((m) => m.id === id)) return;
      // ggml-base.en.bin is English-only; ggml-base.bin is multilingual.
      out.push({ id, label: id, language: /\.en$/i.test(id) ? "en" : null, file });
    };
    const explicit = this.host.env("WHISPER_MODEL");
    if (explicit) add(explicit);
    for (const dir of this.modelDirs()) {
      let entries: string[] = [];
      try {
        entries = await readdir(dir);
      } catch {
        continue;
      }
      for (const entry of entries) if (/^ggml-.*\.bin$/i.test(entry)) add(path.join(dir, entry));
    }
    return out;
  }

  async probe(): Promise<SttProbe> {
    if (this.probeCache && Date.now() - this.probeCache.at < PROBE_TTL_MS) return this.probeCache.probe;
    const started = Date.now();
    const bin = this.binary();
    let probe: SttProbe;
    if (!bin) probe = { state: "absent", reason: "whisper-cli binary not found", setup: INSTALL_HINT };
    else {
      const models = await this.catalog();
      if (!models.length) probe = { state: "absent", reason: `no ggml model in ${this.modelDirs().join(" or ")}`, setup: INSTALL_HINT };
      else {
        const size = await stat(models[0].file).then((s) => s.size).catch(() => 0);
        probe =
          size >= MIN_MODEL_BYTES
            ? { state: "ready", detail: `${models.length} model(s): ${models.map((m) => m.id).join(", ")}` }
            : { state: "broken", reason: `${models[0].file} is ${size} bytes — a truncated download` };
      }
    }
    this.probeCache = { at: Date.now(), probe };
    this.host.log?.({ type: "probe", provider: this.id, probe, ms: Date.now() - started });
    return probe;
  }

  async models(): Promise<SttModel[]> {
    return (await this.catalog()).map(({ id, label, language }) => ({ id, label, language }));
  }

  async transcribe(req: SttRequest, signal?: AbortSignal): Promise<SttTranscript> {
    const bin = this.binary();
    if (!bin) {
      this.invalidateProbe();
      throw new SttError("unavailable", "whisper-cli binary not found", this.id);
    }

    // The container check, before a process is spawned. This package does not
    // transcode (node/wav.ts explains why), so the refusal has to name the fix.
    const info = req.mimeType === "audio/wav" || req.mimeType === "audio/x-wav" ? wavInfo(req.audio) : null;
    if (!info) {
      throw new SttError("invalid_audio", `whisper.cpp reads PCM WAV; got ${req.mimeType}. Convert to 16 kHz mono WAV first.`, this.id);
    }
    if (info.audioFormat !== 1 || info.sampleRate !== REQUIRED_SAMPLE_RATE) {
      throw new SttError(
        "invalid_audio",
        `whisper.cpp needs 16 kHz PCM WAV; this clip is ${info.sampleRate} Hz format ${info.audioFormat}.`,
        this.id,
      );
    }

    const models = await this.catalog();
    const lang = primaryLanguage(req.language);
    const wanted = req.modelId ? models.find((m) => m.id === req.modelId) : null;
    if (req.modelId && !wanted) throw new SttError("invalid_model", `unknown model ${req.modelId}`, this.id);
    // Prefer a model that can actually serve the language: an English-only file
    // asked for Czech returns confident English nonsense, which is worse than a
    // refusal because it looks like a transcript.
    const model = wanted ?? models.find((m) => !m.language || m.language === lang) ?? models[0];
    if (!model) {
      this.invalidateProbe();
      throw new SttError("unavailable", "no ggml model installed", this.id);
    }
    if (lang && model.language && model.language !== lang) {
      throw new SttError("unsupported", `${model.id} is ${model.language}-only and cannot transcribe ${lang}`, this.id);
    }

    return withScratchDir("voice-stt-whisper-", async (dir) => {
      const wav = await writeAudio(dir, "clip.wav", req.audio);
      const outBase = path.join(dir, "out");
      const args = ["-m", model.file, "-f", wav, "-oj", "-of", outBase, "-l", lang || "auto"];
      const threads = this.host.env("WHISPER_THREADS");
      if (threads && /^\d{1,3}$/.test(threads)) args.push("-t", threads);
      const run = await runSidecar(this.id, bin, args, { timeoutMs: this.timeoutMs(), signal });
      if (run.code !== 0) {
        // The engine itself failed, not the request: whatever the last probe
        // said about this install is no longer evidence.
        this.invalidateProbe();
        this.host.log?.({ type: "error", provider: this.id, message: run.stderr.slice(-300) });
        throw new SttError("engine_failed", `whisper-cli exited ${run.code}`, this.id);
      }
      const doc = await readJson<WhisperJson>(`${outBase}.json`, this.id);
      const segments: SttSegment[] = (doc.transcription ?? [])
        .map((s) => ({
          start: (s.offsets?.from ?? 0) / 1000,
          end: (s.offsets?.to ?? 0) / 1000,
          text: (s.text ?? "").trim(),
          // whisper.cpp does not diarize, and a package that invented a speaker
          // label here would be putting words in a named mouth.
          speaker: null,
          confidence: null,
        }))
        .filter((s) => s.text);
      const text = segments.map((s) => s.text).join(" ").trim();
      this.host.log?.({ type: "transcribe", provider: this.id, modelId: model.id, bytes: req.audio.byteLength, ms: run.ms, chars: text.length });
      return {
        text,
        segments,
        language: doc.result?.language ?? lang,
        provider: this.id,
        modelId: model.id,
        elapsedMs: run.ms,
        durationMs: info.durationMs,
        diarized: false,
        redacted: false,
      };
    });
  }
}
