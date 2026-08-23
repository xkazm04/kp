import { test } from "node:test";
import assert from "node:assert/strict";
import { createTts, preferenceFromEnv } from "./registry.ts";
import { FakeTts } from "./providers/fake.ts";
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
  assert.deepEqual(ok, { text: "hello world", language: "cs-cz", voiceId: null, speed: 2 });
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
