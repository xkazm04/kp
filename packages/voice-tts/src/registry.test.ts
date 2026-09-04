import { test } from "node:test";
import assert from "node:assert/strict";
import { createTts, preferenceFromEnv } from "./registry.ts";
import { FakeTts, silentWav } from "./providers/fake.ts";
import { wavInfo } from "./node/wav.ts";
import { TtsError, type TtsHost, type TtsLogEvent } from "./types.ts";
import { validateRequest, TTS_MAX_CHARS } from "./validate.ts";

function host(env: Record<string, string> = {}, log: TtsLogEvent[] = []): TtsHost {
  return { env: (k) => env[k], homeDir: () => "/home/x", cwd: () => "/app", log: (e) => log.push(e) };
}

test("validation door: empty, oversized, bad voice id", () => {
  assert.throws(() => validateRequest({ text: "   " }), (e: TtsError) => e.code === "invalid_text");
  assert.throws(() => validateRequest({ text: "x".repeat(TTS_MAX_CHARS + 1) }), (e: TtsError) => e.code === "invalid_text");
  assert.throws(() => validateRequest({ text: "hi", voiceId: "../etc" }), (e: TtsError) => e.code === "invalid_voice");
  const ok = validateRequest({ text: "  hello   world ", language: "CS-cz", speed: 9 });
  assert.deepEqual(ok, { text: "hello world", language: "cs-cz", voiceId: null, speed: 2, format: "plain" });
});

test("preferenceFromEnv drops unknown ids and keeps preferred inside allowed", () => {
  const p = preferenceFromEnv(host({ A: "Piper", B: "elevenlabs, retired-engine" }), { preferred: "A", allowed: "B" });
  assert.deepEqual(p, { preferred: "piper", allowed: ["piper", "elevenlabs"] });
  const none = preferenceFromEnv(host({}), { preferred: "A", allowed: "B" });
  assert.equal(none.preferred, null);
  assert.deepEqual(none.allowed, ["elevenlabs", "piper", "kokoro"]);
});

test("resolve honors request > preferred > first ready, and fallback is visible", async () => {
  const log: TtsLogEvent[] = [];
  const el = new FakeTts("elevenlabs", { probe: { state: "absent", reason: "no key" }, kind: "cloud" });
  const piper = new FakeTts("piper");
  const kokoro = new FakeTts("kokoro");
  const tts = createTts({ host: host({}, log), providers: [el, piper, kokoro], preference: { preferred: "elevenlabs", allowed: ["elevenlabs", "piper", "kokoro"] } });

  const r1 = await tts.resolve("kokoro");
  assert.equal(r1.provider.id, "kokoro");
  assert.equal(r1.fallbackFrom, null);

  const r2 = await tts.resolve();
  assert.equal(r2.provider.id, "piper");
  assert.equal(r2.fallbackFrom, "elevenlabs");
  assert.match(r2.reason!, /no key/);
  assert.ok(log.some((e) => e.type === "fallback" && e.from === "elevenlabs" && e.to === "piper"));

  const out = await tts.speak({ text: "hello" });
  assert.equal(out.provider, "piper");
  assert.equal(out.fallbackFrom, "elevenlabs");
  assert.equal(piper.calls.length, 1);
});

test("a request outside the allowed set is ignored, not served", async () => {
  const piper = new FakeTts("piper");
  const kokoro = new FakeTts("kokoro");
  const tts = createTts({ host: host(), providers: [piper, kokoro], preference: { preferred: null, allowed: ["piper"] } });
  const r = await tts.resolve("kokoro");
  assert.equal(r.provider.id, "piper");
  assert.equal(kokoro.calls.length, 0);
});

test("nothing ready -> unavailable with the last reason, never empty success", async () => {
  const piper = new FakeTts("piper", { probe: { state: "broken", reason: "model truncated" } });
  const tts = createTts({ host: host(), providers: [piper] });
  await assert.rejects(tts.speak({ text: "hi" }), (e: TtsError) => e.code === "unavailable" && /truncated/.test(e.message));
});

test("status enumerates from the registry, flags allowed + preferred", async () => {
  const tts = createTts({ host: host(), providers: [new FakeTts("piper"), new FakeTts("kokoro")], preference: { preferred: "kokoro", allowed: ["kokoro"] } });
  const s = await tts.status();
  assert.deepEqual(
    s.map((x) => [x.id, x.allowed, x.preferred, x.probe.state]),
    [
      ["piper", false, false, "ready"],
      ["kokoro", true, true, "ready"],
    ],
  );
});

test("above maxClipChars the registry segments and joins ONE valid WAV", async () => {
  // 200 chars of ordinary sentences against a 50-char clip cap: the shape a
  // real long answer takes against a local engine, never exercised before.
  const text =
    "The pipeline scores the candidate. The recruiter reviews the shortlist. " +
    "A message goes out the same day. The interview is booked by the candidate. " +
    "Nothing here needs a human to copy anything.";
  assert.ok(text.length > 150 && text.length < 260);

  const piper = new FakeTts("piper", { capabilities: { maxClipChars: 50 } });
  const tts = createTts({ host: host(), providers: [piper] });
  const out = await tts.speak({ text });

  assert.ok((out.segments ?? 1) > 1, "long text must be segmented");
  assert.equal(out.segments, piper.calls.length);
  assert.ok(piper.calls.every((c) => c.text.length <= 50), "no segment may exceed the clip cap");
  assert.equal(piper.calls.map((c) => c.text).join(" ").replace(/\s+/g, " "), text.replace(/\s+/g, " "));

  // The join is one playable clip, not concatenated files: one header, and the
  // data chunk is the sum of the parts.
  const info = wavInfo(out.bytes);
  const part = wavInfo(silentWav());
  assert.equal(info.sampleRate, part.sampleRate);
  assert.equal(info.channels, part.channels);
  assert.equal(info.bits, part.bits);
  assert.equal(info.dataOffset, 44);
  assert.equal(info.dataBytes, part.dataBytes * out.segments!);
  assert.equal(out.bytes.length, 44 + part.dataBytes * out.segments!);
  assert.equal(String.fromCharCode(...out.bytes.subarray(0, 4)), "RIFF");
  assert.equal(out.mimeType, "audio/wav");
  assert.equal(out.provider, "piper");
});

test("text at or below the cap stays one unsegmented clip", async () => {
  const piper = new FakeTts("piper", { capabilities: { maxClipChars: 50 } });
  const tts = createTts({ host: host(), providers: [piper] });
  const out = await tts.speak({ text: "x".repeat(50) });
  assert.equal(piper.calls.length, 1);
  assert.equal(out.segments, undefined);
});

test("two concurrent local speak() calls serialize; a cloud provider does not", async () => {
  // A one-shot local sidecar reloads its model per call — two at once each run
  // at half speed. The queue is observable as an ORDER, not a timing guess.
  const release: (() => void)[] = [];
  const gate = () => new Promise<void>((r) => release.push(r));

  const trace: string[] = [];
  const piper = new FakeTts("piper", { kind: "local", gate, trace });
  const local = createTts({ host: host(), providers: [piper] });
  const a = local.speak({ text: "first" });
  const b = local.speak({ text: "second" });
  await new Promise((r) => setImmediate(r));
  assert.equal(release.length, 1, "the second local call must not start while the first is in flight");
  release[0]();
  await a;
  await new Promise((r) => setImmediate(r));
  assert.equal(release.length, 2);
  release[1]();
  await b;
  assert.deepEqual(trace, ["piper:start:1", "piper:end:1", "piper:start:2", "piper:end:2"]);

  const cloudRelease: (() => void)[] = [];
  const cloudTrace: string[] = [];
  const el = new FakeTts("elevenlabs", { kind: "cloud", gate: () => new Promise<void>((r) => cloudRelease.push(r)), trace: cloudTrace });
  const cloud = createTts({ host: host(), providers: [el] });
  const c1 = cloud.speak({ text: "first" });
  const c2 = cloud.speak({ text: "second" });
  await new Promise((r) => setImmediate(r));
  assert.equal(cloudRelease.length, 2, "a cloud engine is not queued — concurrency is the point");
  cloudRelease.forEach((r) => r());
  await Promise.all([c1, c2]);
  assert.deepEqual(cloudTrace.slice(0, 2), ["elevenlabs:start:1", "elevenlabs:start:2"]);
});

test("a failed local turn does not wedge the queue for the next caller", async () => {
  const piper = new FakeTts("piper", { kind: "local", fail: new TtsError("engine_failed", "sidecar died", "piper") });
  const tts = createTts({ host: host(), providers: [piper] });
  await assert.rejects(tts.speak({ text: "one" }), (e: TtsError) => e.code === "engine_failed");
  piper.set({ fail: undefined });
  const out = await tts.speak({ text: "two" });
  assert.equal(out.provider, "piper");
});
