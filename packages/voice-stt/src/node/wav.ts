// Minimal WAV header reader. Two jobs, both about telling the truth early:
// reporting a clip's real duration (so a transcript can say how long the audio
// was, and a route can refuse a two-hour upload before it spends anything), and
// letting the local adapter refuse audio in a shape it cannot read INSTEAD OF
// transcoding audio it was never asked to transcode.
//
// Deliberately no decoder and no ffmpeg shell-out: a package that quietly
// resamples has taken on a dependency, a failure mode and a CPU budget the host
// did not agree to. "This engine wants 16 kHz mono PCM WAV, yours is 44.1 kHz
// stereo" is a better answer than a silent conversion that works until it does not.

export type WavInfo = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** PCM = 1. Anything else is a compressed payload in a WAV wrapper. */
  audioFormat: number;
  dataBytes: number;
  durationMs: number;
};

const ascii = (b: Uint8Array, off: number, len: number) => String.fromCharCode(...b.subarray(off, off + len));

/** Parse a canonical RIFF/WAVE header, or null when the bytes are not one. */
export function wavInfo(bytes: Uint8Array): WavInfo | null {
  if (bytes.byteLength < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  // Walk the chunk list rather than assuming fmt-then-data: recorders inject
  // LIST/fact chunks, and a reader that assumes offset 36 mis-sizes those clips.
  while (off + 8 <= bytes.byteLength) {
    const id = ascii(bytes, off, 4);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt " && body + 16 <= bytes.byteLength) {
      fmt = {
        audioFormat: dv.getUint16(body, true),
        channels: dv.getUint16(body + 2, true),
        sampleRate: dv.getUint32(body + 4, true),
        bitsPerSample: dv.getUint16(body + 14, true),
      };
    } else if (id === "data" && fmt) {
      // A truncated download reports a data size larger than the file holds;
      // trust the bytes that are actually there.
      const dataBytes = Math.min(size, bytes.byteLength - body);
      const bytesPerFrame = (fmt.channels * fmt.bitsPerSample) / 8;
      return {
        ...fmt,
        dataBytes,
        durationMs: bytesPerFrame > 0 && fmt.sampleRate > 0 ? Math.round((dataBytes / bytesPerFrame / fmt.sampleRate) * 1000) : 0,
      };
    }
    off = body + size + (size % 2); // chunks are word-aligned
  }
  return null;
}
