// Local adapter: Kokoro through the sherpa-onnx offline-tts sidecar — the same
// wire protocol and install layout the Personas desktop app uses, so one model
// download (~310MB) serves every app on the machine. Out-of-process on purpose:
// the sidecar ships its own ONNX runtime and must not share a process with
// anything that pins a different one. Text is a positional trailing arg, NOT
// stdin (unlike piper). Output is 24 kHz 16-bit WAV.
import path from "node:path";
import { isReadableFile, resolveBinary, sidecarHome } from "../node/resolve-bin.ts";
import { readWav, runSidecar, withScratchDir } from "../node/spawn.ts";
import { TtsError, type TtsAudio, type TtsHost, type TtsProbe, type TtsProvider, type TtsRequest, type TtsVoice } from "../types.ts";

const TIMEOUT_MS = 90_000;
const INSTALL_HINT = "Install the Companion voice in Personas (one click, writes ~/.personas/companion-tts), or set KOKORO_MODEL_DIR to a kokoro-multi-lang-v1_0 folder and KOKORO_BIN to sherpa-onnx-offline-tts.";

/** Friendly id -> speaker id in kokoro-multi-lang-v1_0. Curated small: the
 *  catalog is a picker, not a download, and af_heart=3 is the load-bearing
 *  default shared with Personas. Extend via KOKORO_VOICES="name:sid,name:sid". */
const BUILTIN_VOICES: readonly (TtsVoice & { sid: number })[] = [
  // sids follow the alphabetical order of the v1.0 voice pack as packed in
  // voices.bin (af_alloy=0 … af_heart=3 … am_michael=16 … bf_emma=21).
  // af_heart=3 is verified by ear (shared with Personas); the other two are
  // derived from that ordering — voice choice measurably moves trust, so a
  // picker needs at least one male and one female voice, not one default.
  { id: "af_heart", label: "Heart (en-US, female)", language: "en", sid: 3 },
  { id: "am_michael", label: "Michael (en-US, male)", language: "en", sid: 16 },
  { id: "bf_emma", label: "Emma (en-GB, female)", language: "en", sid: 21 },
];

export class KokoroTts implements TtsProvider {
  readonly id = "kokoro" as const;
  readonly label = "Kokoro (local)";
  readonly kind = "local" as const;
  readonly requiredEnv = ["KOKORO_BIN", "KOKORO_MODEL_DIR"] as const;
  /** The v1.0 multi-language pack speaks 8 languages — NOT Czech or German
   *  (no grapheme-to-phoneme for them); a Czech sentence comes back in an
   *  English accent rather than an error, so hosts route cs/de elsewhere. */
  readonly capabilities = { streaming: false, languages: ["en", "es", "fr", "hi", "it", "ja", "pt", "zh"], speed: true, onDevice: true, maxClipChars: 300 } as const;

  constructor(private readonly host: TtsHost) {}

  private binary(): string | null {
    return resolveBinary(this.host, { envVar: "KOKORO_BIN", name: "sherpa-onnx-offline-tts" });
  }
  private modelDir(): string {
    return this.host.env("KOKORO_MODEL_DIR") || path.join(sidecarHome(this.host), "kokoro");
  }
  private files() {
    const dir = this.modelDir();
    return {
      model: path.join(dir, "model.onnx"),
      voices: path.join(dir, "voices.bin"),
      tokens: path.join(dir, "tokens.txt"),
      data: path.join(dir, "espeak-ng-data"),
      lexicon: [path.join(dir, "lexicon-us-en.txt"), path.join(dir, "lexicon-gb-en.txt")].filter(isReadableFile),
    };
  }

  private catalog(): readonly (TtsVoice & { sid: number })[] {
    const extra = (this.host.env("KOKORO_VOICES") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .flatMap((pair) => {
        const [id, sid] = pair.split(":");
        const n = Number(sid);
        return id && Number.isInteger(n) ? [{ id, label: id, language: null, sid: n }] : [];
      });
    return [...BUILTIN_VOICES, ...extra.filter((e) => !BUILTIN_VOICES.some((b) => b.id === e.id))];
  }

  async probe(): Promise<TtsProbe> {
    const started = Date.now();
    const bin = this.binary();
    const f = this.files();
    let probe: TtsProbe;
    if (!bin) probe = { state: "absent", reason: "sherpa-onnx-offline-tts binary not found", setup: INSTALL_HINT };
    else if (!isReadableFile(f.model)) probe = { state: "absent", reason: `no model.onnx in ${this.modelDir()}`, setup: INSTALL_HINT };
    else if (!isReadableFile(f.voices) || !isReadableFile(f.tokens))
      probe = { state: "broken", reason: `${this.modelDir()} is missing voices.bin or tokens.txt (partial download?)` };
    else probe = { state: "ready", detail: `${this.catalog().length} voice(s)` };
    this.host.log?.({ type: "probe", provider: this.id, probe, ms: Date.now() - started });
    return probe;
  }

  async voices(): Promise<TtsVoice[]> {
    return this.catalog().map(({ id, label, language }) => ({ id, label, language }));
  }

  async synthesize(req: TtsRequest, signal?: AbortSignal): Promise<TtsAudio> {
    const bin = this.binary();
    if (!bin) throw new TtsError("unavailable", "sherpa-onnx-offline-tts binary not found", this.id);
    const f = this.files();
    if (!isReadableFile(f.model)) throw new TtsError("unavailable", "kokoro model not installed", this.id);
    const catalog = this.catalog();
    const voice = req.voiceId ? catalog.find((v) => v.id === req.voiceId) : catalog[0];
    if (!voice) throw new TtsError("invalid_voice", `unknown voice ${req.voiceId}`, this.id);
    return withScratchDir("voice-tts-kokoro-", async (dir) => {
      const out = path.join(dir, "out.wav");
      const args = [
        `--kokoro-model=${f.model}`,
        `--kokoro-voices=${f.voices}`,
        `--kokoro-tokens=${f.tokens}`,
        `--kokoro-data-dir=${f.data}`,
        ...(f.lexicon.length ? [`--kokoro-lexicon=${f.lexicon.join(",")}`] : []),
        "--num-threads=2",
        `--sid=${voice.sid}`,
        `--output-filename=${out}`,
      ];
      if (req.speed && req.speed !== 1) args.push(`--kokoro-length-scale=${1 / req.speed}`);
      args.push(req.text);
      const run = await runSidecar(this.id, bin, args, { timeoutMs: TIMEOUT_MS, signal, cwd: dir });
      if (run.code !== 0) {
        this.host.log?.({ type: "error", provider: this.id, message: run.stderr.slice(-300) });
        throw new TtsError("engine_failed", `sidecar exited ${run.code}`, this.id);
      }
      const bytes = await readWav(out, this.id);
      this.host.log?.({ type: "synthesize", provider: this.id, voiceId: voice.id, chars: req.text.length, ms: run.ms, bytes: bytes.length });
      return { bytes, mimeType: "audio/wav", provider: this.id, voiceId: voice.id, elapsedMs: run.ms };
    });
  }
}
