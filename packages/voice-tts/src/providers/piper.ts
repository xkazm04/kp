// Local adapter: Piper (ONNX, CPU, offline, per-language voices). Text on stdin,
// one WAV per invocation. Voices are discovered from real files in two places:
// the app-local voice dir (PIPER_VOICE_DIR, default <cwd>/data/piper) and the
// shared sidecar home (<home>/piper/<voice>/). Its strength is the language
// catalog (Czech has a good voice); its weakness is voice quality vs Kokoro.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveBinary, sidecarHome } from "../node/resolve-bin.ts";
import { readWav, runSidecar, withScratchDir } from "../node/spawn.ts";
import { primaryLanguage } from "../validate.ts";
import { TtsError, type TtsAudio, type TtsHost, type TtsProbe, type TtsProvider, type TtsRequest, type TtsVoice } from "../types.ts";

const TIMEOUT_MS = 60_000;
const INSTALL_HINT = "pip install piper-tts, then: python -m piper.download_voices --download-dir data/piper en_US-lessac-medium cs_CZ-jirka-medium";

type PiperVoice = TtsVoice & { model: string };

export class PiperTts implements TtsProvider {
  readonly id = "piper" as const;
  readonly label = "Piper (local)";
  readonly kind = "local" as const;
  readonly requiredEnv = ["PIPER_BIN", "PIPER_VOICE_DIR"] as const;
  readonly capabilities = { streaming: false, languages: ["en", "cs"], speed: true, onDevice: true, maxClipChars: 300 } as const;

  constructor(private readonly host: TtsHost) {}

  private binary(): string | null {
    return resolveBinary(this.host, { envVar: "PIPER_BIN", name: "piper" });
  }

  private voiceDirs(): string[] {
    const dirs = [this.host.env("PIPER_VOICE_DIR") || path.join(this.host.cwd(), "data", "piper"), path.join(sidecarHome(this.host), "piper")];
    return [...new Set(dirs)];
  }

  /** Every *.onnx with a sibling .onnx.json, one level deep. */
  private async catalog(): Promise<PiperVoice[]> {
    const out: PiperVoice[] = [];
    for (const dir of this.voiceDirs()) {
      let entries: string[] = [];
      try {
        entries = await readdir(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry);
        const candidates = entry.endsWith(".onnx") ? [full] : await readdir(full).then((l) => l.filter((f) => f.endsWith(".onnx")).map((f) => path.join(full, f))).catch(() => []);
        for (const model of candidates) {
          try {
            const meta = JSON.parse(await readFile(`${model}.json`, "utf8")) as { language?: { code?: string } };
            const id = path.basename(model, ".onnx");
            if (out.some((v) => v.id === id)) continue;
            out.push({ id, label: id, language: primaryLanguage(meta.language?.code?.replace("_", "-")), model });
          } catch {
            /* a model without its json is not a voice */
          }
        }
      }
    }
    return out;
  }

  async probe(): Promise<TtsProbe> {
    const started = Date.now();
    const bin = this.binary();
    let probe: TtsProbe;
    if (!bin) probe = { state: "absent", reason: "piper binary not found", setup: INSTALL_HINT };
    else {
      const voices = await this.catalog();
      if (!voices.length) probe = { state: "absent", reason: `no voices in ${this.voiceDirs().join(" or ")}`, setup: INSTALL_HINT };
      else {
        const ok = await stat(voices[0].model).then((s) => s.size > 1_000_000).catch(() => false);
        probe = ok ? { state: "ready", detail: `${voices.length} voice(s)` } : { state: "broken", reason: `${voices[0].model} is truncated` };
      }
    }
    this.host.log?.({ type: "probe", provider: this.id, probe, ms: Date.now() - started });
    return probe;
  }

  async voices(): Promise<TtsVoice[]> {
    return (await this.catalog()).map(({ id, label, language }) => ({ id, label, language }));
  }

  async synthesize(req: TtsRequest, signal?: AbortSignal): Promise<TtsAudio> {
    const bin = this.binary();
    if (!bin) throw new TtsError("unavailable", "piper binary not found", this.id);
    const voices = await this.catalog();
    const lang = primaryLanguage(req.language);
    const voice = (req.voiceId && voices.find((v) => v.id === req.voiceId)) || (lang && voices.find((v) => v.language === lang)) || voices[0];
    if (!voice) throw new TtsError("unavailable", "no piper voice installed", this.id);
    if (req.voiceId && voice.id !== req.voiceId) throw new TtsError("invalid_voice", `unknown voice ${req.voiceId}`, this.id);
    return withScratchDir("voice-tts-piper-", async (dir) => {
      const out = path.join(dir, "out.wav");
      const args = ["--model", voice.model, "--output_file", out];
      if (req.speed && req.speed !== 1) args.push("--length_scale", String(1 / req.speed));
      const run = await runSidecar(this.id, bin, args, { stdin: req.text, timeoutMs: TIMEOUT_MS, signal });
      if (run.code !== 0) {
        this.host.log?.({ type: "error", provider: this.id, message: run.stderr.slice(-300) });
        throw new TtsError("engine_failed", `piper exited ${run.code}`, this.id);
      }
      const bytes = await readWav(out, this.id);
      this.host.log?.({ type: "synthesize", provider: this.id, voiceId: voice.id, chars: req.text.length, ms: run.ms, bytes: bytes.length });
      return { bytes, mimeType: "audio/wav", provider: this.id, voiceId: voice.id, elapsedMs: run.ms };
    });
  }
}
