import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  TTS_CACHE_MAX_ENTRIES,
  resetTtsCacheForTests,
  speakCached,
  ttsCacheKey,
  ttsCacheLookup,
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

// the-cache-relieves-the-throttle-and-dedupes-in-flight ------------------------

test("two presses INSIDE one synthesis are one engine call, not two", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow = {
    speak: async () => {
      calls += 1;
      await gate;
      return {
        bytes: new Uint8Array(8).fill(1),
        mimeType: "audio/mpeg" as const,
        provider: "elevenlabs" as const,
        voiceId: "v",
        elapsedMs: 5,
        fallbackFrom: null,
        unsupportedLanguage: null,
      };
    },
  };
  const req: TtsRequest = { text: "the same sentence, twice" };
  const first = speakCached(slow as never, req);
  const second = speakCached(slow as never, req);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1, "the overlapping request joined the call in flight");
  assert.equal(a.cached, false);
  assert.equal(b.cached, true, "the joiner spent nothing, so its ledger row is a zero");
  assert.deepEqual(Array.from(b.audio.bytes), Array.from(a.audio.bytes));
});

test("an in-flight call that FAILS is evicted, so the next caller gets a real attempt", async () => {
  let calls = 0;
  let fail!: () => void;
  const gate = new Promise<void>((_, reject) => (fail = () => reject(new Error("engine down"))));
  const failing = {
    speak: async () => {
      calls += 1;
      await gate;
      throw new Error("unreachable");
    },
  };
  const req: TtsRequest = { text: "this one breaks" };
  const first = speakCached(failing as never, req);
  const second = speakCached(failing as never, req);
  fail();
  await assert.rejects(() => first);
  await assert.rejects(() => second, "the joiner sees the same failure, never a stale success");
  assert.equal(calls, 1);
  assert.equal(ttsCacheStats().entries, 0);
  // …and the NEXT caller is a fresh attempt rather than a remembered failure.
  await assert.rejects(() => speakCached(failing as never, req));
  assert.equal(calls, 2);
});

test("the key is built from the VALIDATED request, so equivalent asks are one clip", async () => {
  // Everything the validation door collapses: speed clamped at 2, the language
  // tag lower-cased, whitespace squeezed, an absent format defaulted to plain.
  assert.equal(
    ttsCacheKey({ text: "hello", speed: 9 }),
    ttsCacheKey({ text: "hello", speed: 2, format: "plain" }),
    "speed 9 IS speed 2 — validate clamps it before any engine sees it",
  );
  assert.equal(ttsCacheKey({ text: "hello", language: "CS-cz" }), ttsCacheKey({ text: "hello", language: "cs-cz" }));
  const tts = fakeTts();
  await speakCached(tts, { text: " hello ", speed: 3 });
  await speakCached(tts, { text: "hello", speed: 2 });
  assert.equal(tts.calls(), 1, "the second ask resolves to the same synthesis");
});

test("ttsCacheLookup never synthesizes and never throws", async () => {
  const tts = fakeTts();
  const req: TtsRequest = { text: "a stored line" };
  assert.equal(ttsCacheLookup(req), null, "an empty cache is a miss, not a call");
  await speakCached(tts, req);
  const hit = ttsCacheLookup(req);
  assert.equal(hit?.cached, true);
  assert.equal(tts.calls(), 1, "the lookup half touched no engine");
  // An unvalidatable request has no clip by construction: a miss, not a throw —
  // the route refuses it with its own code right after.
  assert.equal(ttsCacheLookup({ text: "   " }), null);
  assert.equal(ttsCacheLookup({ text: "hi", voiceId: "../etc" }), null);
});
