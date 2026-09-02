// The test seam: a scripted engine with injectable probe outcomes, capabilities
// and failures. If testing a transcription surface needs a real engine, the
// interface is in the wrong place — this fake is the proof that the interface
// contains the engine.
import { SttError, type SttCapabilities, type SttModel, type SttProbe, type SttProvider, type SttProviderId, type SttRequest, type SttTranscript } from "../types.ts";

/** A 44-byte 16 kHz mono PCM WAV header + n silent samples — the shape the local
 *  adapter demands, so a test can exercise the real container check. */
export function silentWav(samples = 160, sampleRate = 16_000): Uint8Array {
  const buf = new Uint8Array(44 + samples * 2);
  const dv = new DataView(buf.buffer);
  const ascii = (off: number, s: string) => [...s].forEach((c, i) => (buf[off + i] = c.charCodeAt(0)));
  ascii(0, "RIFF");
  dv.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ascii(36, "data");
  dv.setUint32(40, samples * 2, true);
  return buf;
}

const BASE_CAPS: SttCapabilities = {
  streaming: false,
  languages: "any",
  onDevice: true,
  diarization: false,
  redaction: false,
  maxClipSeconds: 3600,
  maxBytes: 25 * 1024 * 1024,
};

export class FakeStt implements SttProvider {
  readonly label: string;
  readonly kind: "cloud" | "local";
  readonly requiredEnv = [] as const;
  readonly capabilities: SttCapabilities;
  calls: SttRequest[] = [];
  /** Probes are counted, not just answered: "was this engine probed at all?" is
   *  the assertion that proves the capability gate ran BEFORE the probe. */
  probes = 0;

  constructor(
    readonly id: SttProviderId,
    private opts: {
      probe?: SttProbe;
      kind?: "cloud" | "local";
      fail?: SttError;
      text?: string;
      capabilities?: Partial<SttCapabilities>;
      models?: SttModel[];
    } = {},
  ) {
    this.label = `fake:${id}`;
    this.kind = opts.kind ?? "local";
    this.capabilities = { ...BASE_CAPS, onDevice: this.kind === "local", ...opts.capabilities };
  }
  set(opts: Partial<typeof this.opts>) {
    this.opts = { ...this.opts, ...opts };
  }
  async probe(): Promise<SttProbe> {
    this.probes += 1;
    return this.opts.probe ?? { state: "ready" };
  }
  async models(): Promise<SttModel[]> {
    return this.opts.models ?? [{ id: "m1", label: "Fake model", language: null }];
  }
  async transcribe(req: SttRequest): Promise<SttTranscript> {
    this.calls.push(req);
    if (this.opts.fail) throw this.opts.fail;
    const text = this.opts.text ?? "hello";
    return {
      text,
      segments: [{ start: 0, end: 1, text, speaker: req.diarize ? "A" : null, confidence: 0.9 }],
      language: req.language ?? null,
      provider: this.id,
      modelId: req.modelId ?? "m1",
      elapsedMs: 1,
      durationMs: 1000,
      diarized: req.diarize === true && this.capabilities.diarization,
      redacted: req.redactPii === true && this.capabilities.redaction,
    };
  }
}
