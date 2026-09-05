import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  TTS_CACHE_MAX_ENTRIES,
  resetTtsCacheForTests,
  speakCached,
  ttsCacheKey,
  ttsCacheStats,
} from "./tts-cache.ts";
import type { TtsRequest } from "@/packages/voice-tts/src/index";

/** A counting stand-in for the registry: it never reaches an engine, and it
 *  reports how many syntheses the host actually asked for — which is the whole
 *  claim this direction makes. */
function fakeTts(bytesPerCall = 8) {
  let calls = 0;
  return {
    calls: () => calls,
    speak: async (req: TtsRequest) => {
      calls += 1;
      return {
        bytes: new Uint8Array(bytesPerCall).fill(calls),
        mimeType: "audio/mpeg" as const,
        provider: "elevenlabs" as const,
        voiceId: `voice-${req.language ?? "en"}`,
        elapsedMs: 5,
        fallbackFrom: null,
        unsupportedLanguage: null,
      };
    },
  };
}

beforeEach(() => resetTtsCacheForTests());

test("auto-speak then a replay of the same turn is ONE synthesis", async () => {
  const tts = fakeTts();
  const req: TtsRequest = { text: "29 decisions are waiting.", language: "en", format: "plain" };
  const first = await speakCached(tts, req);
  const second = await speakCached(tts, req);
  assert.equal(tts.calls(), 1, "the second serve must not reach an engine");
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(Array.from(second.audio.bytes), Array.from(first.audio.bytes));
});

test("whitespace is the only difference that folds", async () => {
  const tts = fakeTts();
  await speakCached(tts, { text: "one  two\nthree" });
  await speakCached(tts, { text: " one two three " });
  assert.equal(tts.calls(), 1);
});

test("language, voice, speed, format and the requested provider each split the key", async () => {
  const base: TtsRequest = { text: "hello", language: "en", voiceId: "a", speed: 1, format: "plain" };
  assert.notEqual(ttsCacheKey(base), ttsCacheKey({ ...base, language: "cs" }), "a cs request must never get en audio");
  assert.notEqual(ttsCacheKey(base), ttsCacheKey({ ...base, voiceId: "b" }));
  assert.notEqual(ttsCacheKey(base), ttsCacheKey({ ...base, speed: 1.2 }));
  assert.notEqual(ttsCacheKey(base), ttsCacheKey({ ...base, format: "chat" }));
  assert.notEqual(ttsCacheKey(base, "piper"), ttsCacheKey(base, "kokoro"));
  assert.equal(ttsCacheKey(base), ttsCacheKey({ ...base }), "identical requests are one key");
});

test("a different language really does resynthesize", async () => {
  const tts = fakeTts();
  await speakCached(tts, { text: "hello", language: "en" });
  await speakCached(tts, { text: "hello", language: "cs" });
  assert.equal(tts.calls(), 2);
});

test("the window evicts by ENTRY COUNT, least-recently-used first", async () => {
  const tts = fakeTts();
  for (let i = 0; i < TTS_CACHE_MAX_ENTRIES; i += 1) await speakCached(tts, { text: `line ${i}` });
  assert.equal(ttsCacheStats().entries, TTS_CACHE_MAX_ENTRIES);
  // Touch the oldest so it is no longer the least-recently-used…
  const warm = await speakCached(tts, { text: "line 0" });
  assert.equal(warm.cached, true);
  // …then push one past the ceiling: "line 1" is now the coldest, not "line 0".
  await speakCached(tts, { text: "one more" });
  assert.equal(ttsCacheStats().entries, TTS_CACHE_MAX_ENTRIES);
  assert.equal((await speakCached(tts, { text: "line 0" })).cached, true, "the touched entry survived");
  assert.equal((await speakCached(tts, { text: "line 1" })).cached, false, "the coldest entry was evicted");
});

test("the window evicts by BYTES even when the entry count is fine", async () => {
  const tts = fakeTts(3 * 1024 * 1024); // 3 MB per clip: 6 clips is over the 16 MB bound
  for (let i = 0; i < 6; i += 1) await speakCached(tts, { text: `clip ${i}` });
  const stats = ttsCacheStats();
  assert.ok(stats.entries < 6, `bytes bound must evict before 6 entries, held ${stats.entries}`);
  assert.ok(stats.bytes <= 16 * 1024 * 1024, `held ${stats.bytes} bytes`);
});

test("a clip too large to hold is served but never stored", async () => {
  const tts = fakeTts(5 * 1024 * 1024);
  const served = await speakCached(tts, { text: "a very long reply" });
  assert.equal(served.cached, false);
  assert.equal(ttsCacheStats().entries, 0, "one oversized payload must not evict the whole window");
  await speakCached(tts, { text: "a very long reply" });
  assert.equal(tts.calls(), 2, "and it is honestly re-synthesized rather than silently wrong");
});

test("a failed synthesis is not remembered as a result", async () => {
  let calls = 0;
  const failing = {
    speak: async () => {
      calls += 1;
      throw new Error("unavailable");
    },
  };
  await assert.rejects(() => speakCached(failing as never, { text: "hi" }));
  await assert.rejects(() => speakCached(failing as never, { text: "hi" }));
  assert.equal(calls, 2, "the keyless refusal must be re-asked, never cached");
  assert.equal(ttsCacheStats().entries, 0);
});

test("a stored clip cannot be mutated through the caller's copy", async () => {
  const tts = fakeTts();
  const first = await speakCached(tts, { text: "hello" });
  first.audio.bytes.fill(0xff);
  const second = await speakCached(tts, { text: "hello" });
  assert.notDeepEqual(Array.from(second.audio.bytes), Array.from(first.audio.bytes));
});
