// The test seam: a scripted engine with injectable probe outcomes and failures.
// If testing a voice surface needs a real engine, the interface is in the wrong
// place — this fake is the proof that the interface contains the engine.
import { TtsError, type TtsAudio, type TtsCapabilities, type TtsProbe, type TtsProvider, type TtsProviderId, type TtsRequest, type TtsVoice } from "../types.ts";

/** A 44-byte silent WAV header + n silent samples. */
export function silentWav(samples = 160): Uint8Array {
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
  dv.setUint32(24, 16000, true);
  dv.setUint32(28, 32000, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ascii(36, "data");
  dv.setUint32(40, samples * 2, true);
  return buf;
}

const DEFAULT_CAPABILITIES: TtsCapabilities = { streaming: false, languages: "any", speed: true, onDevice: true, maxClipChars: 1200 };

export type FakeTtsOptions = {
  probe?: TtsProbe;
  kind?: "cloud" | "local";
  fail?: TtsError;
  voices?: TtsVoice[];
  /** Override any capability — `maxClipChars` is what drives the registry's
   *  segment-and-join path, and a 1200-char default makes that path untestable
   *  without a 1200-char fixture. */
  capabilities?: Partial<TtsCapabilities>;
  /** Suspend synthesize() until the returned resolver is called, so a test can
   *  observe whether two speak() calls overlap. */
  gate?: () => Promise<void>;
  /** Append "start:<n>" / "end:<n>" per synthesize call. Interleaving is then
   *  an ORDER, not a timing guess: serialized runs never read start,start. */
  trace?: string[];
};

export class FakeTts implements TtsProvider {
  readonly label: string;
  readonly kind: "cloud" | "local";
  readonly requiredEnv = [] as const;
  readonly capabilities: TtsCapabilities;
  calls: TtsRequest[] = [];

  constructor(
    readonly id: TtsProviderId,
    private opts: FakeTtsOptions = {},
  ) {
    this.label = `fake:${id}`;
    this.kind = opts.kind ?? "local";
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...opts.capabilities };
  }
  set(opts: Partial<FakeTtsOptions>) {
    this.opts = { ...this.opts, ...opts };
  }
  async probe(): Promise<TtsProbe> {
    return this.opts.probe ?? { state: "ready" };
  }
  async voices(): Promise<TtsVoice[]> {
    return this.opts.voices ?? [{ id: "v1", label: "Fake voice", language: "en" }];
  }
  async synthesize(req: TtsRequest): Promise<TtsAudio> {
    const n = this.calls.push(req);
    this.opts.trace?.push(`${this.id}:start:${n}`);
    try {
      if (this.opts.gate) await this.opts.gate();
      if (this.opts.fail) throw this.opts.fail;
      return { bytes: silentWav(), mimeType: "audio/wav", provider: this.id, voiceId: req.voiceId || "v1", elapsedMs: 1 };
    } finally {
      this.opts.trace?.push(`${this.id}:end:${n}`);
    }
  }
}
