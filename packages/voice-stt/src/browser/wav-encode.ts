// The browser half of "this package does not transcode".
//
// `node/wav.ts` explains why the SERVER side carries no decoder: a package that
// quietly resamples has taken on a dependency, a failure mode and a CPU budget
// the host never agreed to. That reasoning holds for the server and produces a
// dead end in the browser, because the browser is where the mismatch is created:
// `MediaRecorder` yields Opus in a WebM container, whisper.cpp reads 16 kHz PCM
// WAV and nothing else (providers/whisper-cpp.ts), and the package leads with the
// on-device engine on purpose (types.ts, STT_PROVIDER_IDS). So on a default
// install every mic click was a 400, and on a residency-locked deploy there was
// no second engine to fall back to.
//
// The resolution is not a decoder: it is the ONE conversion the platform already
// owns. `AudioContext.decodeAudioData` decodes whatever the browser recorded
// (that is the same codec the same browser just wrote), and everything after it
// -- channel mixdown, rate conversion, PCM16 framing -- is arithmetic over
// Float32Array with no dependency and no platform call. That split is why the
// three functions below are exported separately from `encodeWavFromBlob`: the
// conversion that decides whether the transcript is right is PURE and pinned by
// tests on synthetic PCM, and only the decode step needs a browser.
//
// Rate conversion is linear interpolation, deliberately, with no low-pass ahead
// of it. Downsampling 48 kHz speech to 16 kHz aliases anything above 8 kHz back
// into the band, and a polyphase filter would be the correct answer for music.
// For speech into an ASR model it is not worth a filter bank in a
// dependency-free package: whisper's own front end is a 16 kHz mel spectrogram
// and the energy above 8 kHz in a voice recording is fricative hiss. If a future
// engine proves otherwise, the seam to change is `resampleLinear` alone.

/** What whisper.cpp reads, and what this module always emits. */
export const WAV_TARGET_SAMPLE_RATE = 16000;

/** Average N channel buffers into one.
 *
 *  Average rather than take channel 0: a laptop with a stereo input array often
 *  puts most of the speaker's energy in one channel, and picking the wrong one
 *  is a quiet recording that transcribes as silence. Buffers of differing length
 *  (which no decoder should produce, but a caller assembling frames might) are
 *  read to the SHORTEST: padding the tail with zeros from a missing channel
 *  would halve the amplitude of real audio. */
export function mixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const frames = channels.reduce((min, c) => Math.min(min, c.length), Infinity);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i];
    out[i] = sum / channels.length;
  }
  return out;
}

/** Linear-interpolating rate conversion.
 *
 *  Length is `round(input.length * toRate / fromRate)`, rounded rather than
 *  floored, so a clip's duration survives the trip to within one sample instead
 *  of losing up to a whole output frame per call. Equal rates return the input
 *  untouched (a 16 kHz-capable device must not pay a copy), and a caller with
 *  nothing to convert gets an empty buffer instead of a NaN-filled one. */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) throw new RangeError(`resampleLinear: rates must be positive, got ${fromRate} -> ${toRate}`);
  if (fromRate === toRate || input.length === 0) return input;
  const frames = Math.round((input.length * toRate) / fromRate);
  const out = new Float32Array(frames);
  const step = fromRate / toRate;
  for (let i = 0; i < frames; i++) {
    const pos = i * step;
    const left = Math.floor(pos);
    const frac = pos - left;
    const a = input[left] ?? 0;
    // The final output frame can land on the last input sample; hold it rather
    // than interpolating toward an implicit zero, which would put a click at the
    // end of every clip.
    const b = left + 1 < input.length ? input[left + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Mono Float32 (-1..1) to a canonical 44-byte-header PCM16 WAV.
 *
 *  Samples are CLAMPED before scaling: a decoder is allowed to return values
 *  slightly past the unit range (and a caller may have applied gain), and letting
 *  one wrap through the Int16 range turns a loud syllable into a burst of noise
 *  the model then transcribes as a word. Scaling is asymmetric (32768 down,
 *  32767 up) so the unit range maps exactly onto the Int16 range. */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError(`encodeWav16: sampleRate must be positive, got ${sampleRate}`);
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const dv = new DataView(bytes.buffer);
  const ascii = (off: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[off + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  dv.setUint32(16, 16, true); // PCM fmt chunk size
  dv.setUint16(20, 1, true); // audioFormat: PCM
  dv.setUint16(22, 1, true); // channels: mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); // byte rate = rate * channels * 2
  dv.setUint16(32, 2, true); // block align
  dv.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  dv.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return bytes;
}

/** The inverse, for tests and for a host that wants to inspect what it uploaded.
 *  Pure, and the reason the round trip above can be asserted without a browser. */
export function decodeWav16(bytes: Uint8Array): Float32Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames = Math.floor((bytes.byteLength - 44) / 2);
  const out = new Float32Array(Math.max(0, frames));
  for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(44 + i * 2, true) / 0x8000;
  return out;
}

export type WavEncodeResult = {
  /** `audio/wav`, ready to be the `audio` part of the host route's multipart. */
  blob: Blob;
  sampleRate: number;
  durationMs: number;
};

/** The one impure step: decode whatever was recorded, then run the pure chain.
 *
 *  `AudioContext` rather than `OfflineAudioContext`: the resampling is ours (and
 *  tested), so all the platform is asked for is the decode of a codec it just
 *  wrote. The context is closed in a `finally`; a browser allows only a handful
 *  of live audio contexts per document, and leaking one per recording makes the
 *  fourth mic press fail with no error anyone can read. */
export async function encodeWavFromBlob(blob: Blob, targetRate: number = WAV_TARGET_SAMPLE_RATE): Promise<WavEncodeResult> {
  const scope = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) throw new Error("no AudioContext: this browser cannot decode the recording");
  const ctx = new Ctor();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
    const mono = resampleLinear(mixToMono(channels), decoded.sampleRate, targetRate);
    return {
      blob: new Blob([encodeWav16(mono, targetRate)], { type: "audio/wav" }),
      sampleRate: targetRate,
      durationMs: Math.round((mono.length / targetRate) * 1000),
    };
  } finally {
    // Best-effort: a context that refused to close is a leak worth a retry on the
    // next press, never a reason to lose the recording the caller is holding.
    void ctx.close().catch(() => {});
  }
}
