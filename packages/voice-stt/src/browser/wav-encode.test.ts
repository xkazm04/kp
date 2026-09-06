// The conversion that decides whether a browser recording is transcribable at
// all, pinned on synthetic PCM. No DOM: `encodeWavFromBlob` needs a real
// `AudioContext.decodeAudioData` and is NOT covered here (see the README's
// "Tests" section) -- everything after the decode is arithmetic, and that is the
// half that was missing and the half that can be wrong quietly.
//
// The header assertions go through `node/wav.ts`, the reader the SERVER uses to
// accept or refuse this clip. Asserting our own bytes against our own constants
// would pass while shipping a clip whisper.cpp refuses; asserting them through
// the refusal path is the actual contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wavInfo } from "../node/wav.ts";
import { WAV_TARGET_SAMPLE_RATE, decodeWav16, encodeWav16, mixToMono, resampleLinear } from "./wav-encode.ts";

/** A 440 Hz sine, the length of one second at `rate`. */
function sine(rate: number, seconds = 1, hz = 440): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

test("48 kHz resamples to exactly the 16 kHz sample count", () => {
  const input = sine(48000);
  const out = resampleLinear(input, 48000, WAV_TARGET_SAMPLE_RATE);
  assert.equal(out.length, 16000);
  // A one-second clip is still one second: the durations must agree, not just
  // the counts. (Off-by-a-frame here is how a clip's reported length drifts.)
  assert.equal(Math.round((out.length / 16000) * 1000), Math.round((input.length / 48000) * 1000));
});

test("a downsampled sine keeps its shape, not just its length", () => {
  // Every third input sample IS an output sample at a 3:1 ratio, so the
  // interpolator must reproduce it. A resampler that indexed off by one, or
  // interpolated in the wrong direction, still returns 16000 samples.
  const input = sine(48000);
  const out = resampleLinear(input, 48000, 16000);
  for (const i of [0, 1, 100, 5000, 15999]) {
    assert.ok(Math.abs(out[i] - input[i * 3]) < 1e-6, `frame ${i}: ${out[i]} vs ${input[i * 3]}`);
  }
});

test("an odd ratio rounds the frame count rather than dropping a frame", () => {
  assert.equal(resampleLinear(new Float32Array(44100), 44100, 16000).length, 16000);
  // 1000 frames at 44.1k is 362.81 frames at 16k: rounding up is nearer the
  // truth than the floor, and neither is allowed to be 0 or NaN.
  assert.equal(resampleLinear(new Float32Array(1000), 44100, 16000).length, 363);
});

test("an already-16 kHz buffer is returned untouched, and an empty one stays empty", () => {
  const input = sine(16000, 0.01);
  assert.equal(resampleLinear(input, 16000, 16000), input);
  assert.equal(resampleLinear(new Float32Array(0), 48000, 16000).length, 0);
});

test("a non-positive rate is refused, never divided by", () => {
  assert.throws(() => resampleLinear(sine(16000, 0.01), 0, 16000), RangeError);
  assert.throws(() => resampleLinear(sine(16000, 0.01), 48000, -1), RangeError);
  assert.throws(() => encodeWav16(new Float32Array(4), 0), RangeError);
});

test("the encoded header is one the SERVER's reader accepts as 16 kHz mono PCM", () => {
  const bytes = encodeWav16(resampleLinear(sine(48000), 48000, WAV_TARGET_SAMPLE_RATE), WAV_TARGET_SAMPLE_RATE);
  const info = wavInfo(bytes);
  assert.ok(info, "wavInfo could not parse what encodeWav16 produced");
  // Exactly the four facts whisper-cpp.ts checks before it spawns anything.
  assert.equal(info.audioFormat, 1);
  assert.equal(info.sampleRate, 16000);
  assert.equal(info.channels, 1);
  assert.equal(info.bitsPerSample, 16);
  assert.equal(info.dataBytes, 32000);
  assert.equal(info.durationMs, 1000);
  assert.equal(bytes.byteLength, 44 + 32000);
});

test("the samples round-trip through PCM16 within a quantisation step", () => {
  // Two quantisation steps, not one: the scale is asymmetric on purpose (32767
  // up, 32768 down, so the unit range lands exactly on the Int16 range), which
  // costs one step of scale error on the positive half on top of the half-step
  // of rounding. That is the real bound, and pinning a tighter one only pins the
  // sine's own maximum rather than the encoder's.
  const tolerance = 2 / 32768;
  const input = sine(16000, 0.05);
  const back = decodeWav16(encodeWav16(input, 16000));
  assert.equal(back.length, input.length);
  for (let i = 0; i < input.length; i++) {
    assert.ok(Math.abs(back[i] - input[i]) < tolerance, `frame ${i} drifted: ${back[i]} vs ${input[i]}`);
  }
});

test("out-of-range samples clamp instead of wrapping into noise", () => {
  // The failure this prevents is audible and mis-transcribed: an Int16 that
  // wraps turns the loudest syllable into its own negation.
  const back = decodeWav16(encodeWav16(new Float32Array([2, -2, 1, -1, 0]), 16000));
  assert.ok(back[0] > 0.999 && back[1] < -0.999);
  assert.ok(back[2] > 0.999 && back[3] === -1);
  assert.equal(back[4], 0);
});

test("channels are averaged, so a one-sided stereo mic is not silence", () => {
  const left = new Float32Array([1, 1, 1]);
  const right = new Float32Array([0, 0, 0]);
  assert.deepEqual([...mixToMono([left, right])], [0.5, 0.5, 0.5]);
  assert.equal(mixToMono([left]), left, "a mono decode must not pay for a copy");
  assert.equal(mixToMono([]).length, 0);
});

test("channels of unequal length are read to the shortest, never zero-padded", () => {
  // Zero-padding would halve the amplitude of the tail of a real recording.
  assert.deepEqual([...mixToMono([new Float32Array([1, 1, 1]), new Float32Array([1, 1])])], [1, 1]);
});
