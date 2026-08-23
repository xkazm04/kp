// Minimal WAV plumbing so every adapter can hand back the same container:
// raw 16-bit PCM (a cloud engine's pcm_* format) gets a header; per-chunk WAVs
// of one rate concatenate without re-encoding. A by-ear comparison between
// engines is only honest when the container and codec are identical — an MP3
// against a WAV mostly measures the codec.
import { TtsError, type TtsProviderId } from "../types.ts";

export function wavHeader(dataBytes: number, sampleRate: number, channels = 1, bits = 16): Uint8Array {
  const h = new Uint8Array(44);
  const dv = new DataView(h.buffer);
  const ascii = (off: number, s: string) => [...s].forEach((c, i) => (h[off + i] = c.charCodeAt(0)));
  ascii(0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, (sampleRate * channels * bits) / 8, true);
  dv.setUint16(32, (channels * bits) / 8, true);
  dv.setUint16(34, bits, true);
  ascii(36, "data");
  dv.setUint32(40, dataBytes, true);
  return h;
}

export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  out.set(wavHeader(pcm.length, sampleRate), 0);
  out.set(pcm, 44);
  return out;
}

export function wavInfo(wav: Uint8Array): { sampleRate: number; channels: number; bits: number; dataOffset: number; dataBytes: number } {
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const channels = dv.getUint16(22, true);
  const sampleRate = dv.getUint32(24, true);
  const bits = dv.getUint16(34, true);
  // Walk chunks to the data chunk (some writers add LIST chunks).
  let off = 12;
  while (off + 8 <= wav.length) {
    const id = String.fromCharCode(wav[off], wav[off + 1], wav[off + 2], wav[off + 3]);
    const size = dv.getUint32(off + 4, true);
    if (id === "data") return { sampleRate, channels, bits, dataOffset: off + 8, dataBytes: Math.min(size, wav.length - off - 8) };
    off += 8 + size + (size & 1);
  }
  return { sampleRate, channels, bits, dataOffset: 44, dataBytes: wav.length - 44 };
}

/** Join WAV clips of one rate/channel layout into one clip. */
export function concatWav(clips: Uint8Array[], provider: TtsProviderId): Uint8Array {
  if (clips.length === 1) return clips[0];
  const infos = clips.map(wavInfo);
  const { sampleRate, channels, bits } = infos[0];
  if (infos.some((i) => i.sampleRate !== sampleRate || i.channels !== channels || i.bits !== bits)) {
    throw new TtsError("engine_failed", "segments have different audio formats", provider);
  }
  const total = infos.reduce((n, i) => n + i.dataBytes, 0);
  const out = new Uint8Array(44 + total);
  out.set(wavHeader(total, sampleRate, channels, bits), 0);
  let off = 44;
  clips.forEach((c, k) => {
    out.set(c.subarray(infos[k].dataOffset, infos[k].dataOffset + infos[k].dataBytes), off);
    off += infos[k].dataBytes;
  });
  return out;
}
