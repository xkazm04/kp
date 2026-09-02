import { createHash } from "node:crypto";
import type { Tts, TtsAudio, TtsProviderId, TtsRequest } from "@/packages/voice-tts/src/index";

/*
 * THE SAME SENTENCE IS SYNTHESIZED ONCE.
 *
 * /api/tts is the one paid leg the companion walks on its own, and it had no
 * memory: `cache-control: no-store` on the response plus no host-side store
 * meant auto-speak followed by the operator pressing play (the ordinary shape
 * once a browser has blocked autoplay), or arrowing back to an answer and
 * playing it again, paid ElevenLabs twice for identical bytes. A digest of the
 * request is all it takes to make the second one free.
 *
 * IN-MEMORY, NOT SQLITE — deliberate, and the trade-off is stated rather than
 * hidden. Process lifetime is the wrong bound for a bill and the right bound
 * for everything else: audio blobs are the one payload in this app that would
 * grow a SQLite file by megabytes per conversation, a restart is rare next to a
 * replay (the two requests this exists to fold together are seconds apart), and
 * a table would need a migration, a tenancy verdict and an eviction sweep to
 * buy back a hit rate that a 64-entry window already gets most of. The audit
 * trail is NOT in this cache: every serve — hit or miss — writes its own
 * llm_usage row, so what was spent survives the restart even though the bytes
 * do not.
 *
 * BOUNDED TWICE, because either bound alone leaks. Entries cap a conversation's
 * worth of short clips; bytes cap the one long prose reply that would otherwise
 * hold 20 MB of WAV on its own. Eviction is least-recently-USED (a hit moves an
 * entry to the back), so replaying an old answer keeps it warm.
 *
 * LOCAL PROVIDERS ARE CACHED TOO, though they spend nothing. The direction
 * offered a bypass; the measurement argues against it — a Piper clip costs
 * seconds of CPU and a spawned sidecar per call, which is latency the operator
 * feels and a process the machine has to find room for. The bytes bound is what
 * keeps that safe, and it applies to every provider equally.
 */

/** Uncached ceiling: entries, and total bytes held. */
export const TTS_CACHE_MAX_ENTRIES = 64;
export const TTS_CACHE_MAX_BYTES = 16 * 1024 * 1024;
/** A single clip larger than this is served but never stored — one payload that
 *  evicts the whole window on the way in is a cache that holds nothing. */
export const TTS_CACHE_MAX_ENTRY_BYTES = 4 * 1024 * 1024;

export type ServedTtsAudio = TtsAudio & { fallbackFrom: TtsProviderId | null };

/** Just the method this module needs, so a test can hand it a double without
 *  building a registry (and so nothing here can reach an engine by accident). */
export type TtsSpeaker = Pick<Tts, "speak">;

type Entry = { audio: ServedTtsAudio; bytes: number };

const cache = new Map<string, Entry>();
let heldBytes = 0;

/** Whitespace is the only thing normalised away: two requests that differ by a
 *  newline are the same utterance to every engine, and `speechReady` (the one
 *  speech normalizer, in the package) has already run on the caller's side for
 *  a companion turn. Nothing else is touched — case and punctuation change
 *  prosody, so folding them would return audio that is not what was asked for. */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The identity of one synthesis request.
 *
 * Provider + voice + a sha256 of the normalised text, PLUS language, speed and
 * format — every input that changes the bytes belongs in the key or the cache
 * answers a Czech request with English audio. `provider` is the one the caller
 * ASKED for ("auto" when it let the registry resolve), because that is what is
 * known before the call; a deploy whose preferred engine goes down mid-process
 * therefore keeps serving the old engine's clip for these 64 entries, which is
 * the bounded price of not paying twice.
 */
export function ttsCacheKey(req: TtsRequest, provider?: unknown): string {
  const digest = createHash("sha256").update(normalizeText(req.text ?? ""), "utf8").digest("hex");
  const parts = [
    typeof provider === "string" && provider ? provider : "auto",
    req.voiceId ?? "",
    req.language ?? "",
    req.speed == null ? "" : String(req.speed),
    req.format ?? "",
    digest,
  ];
  return parts.join("|");
}

function evict(): void {
  for (const [key, entry] of cache) {
    if (cache.size <= TTS_CACHE_MAX_ENTRIES && heldBytes <= TTS_CACHE_MAX_BYTES) return;
    cache.delete(key);
    heldBytes -= entry.bytes;
  }
}

function store(key: string, audio: ServedTtsAudio): void {
  const bytes = audio.bytes.byteLength;
  if (bytes > TTS_CACHE_MAX_ENTRY_BYTES) return;
  const previous = cache.get(key);
  if (previous) heldBytes -= previous.bytes;
  // A copy, so a caller that later views or transfers the buffer cannot mutate
  // what the next hit will serve.
  cache.set(key, { audio: { ...audio, bytes: audio.bytes.slice() }, bytes });
  heldBytes += bytes;
  evict();
}

export type TtsServeResult = {
  audio: ServedTtsAudio;
  /** True when no engine ran — the ledger row for this serve is a zero. */
  cached: boolean;
  key: string;
};

/**
 * Speak `req`, or hand back the bytes an identical request already produced.
 *
 * The registry instance is a parameter rather than an import so the route keeps
 * owning the singleton and a unit test can prove "one synthesis, two requests"
 * with a counting double. A throw (the keyless `unavailable`, a timeout, an
 * engine fault) propagates untouched and stores nothing: a failure is not a
 * result to remember.
 */
export async function speakCached(
  tts: TtsSpeaker,
  req: TtsRequest,
  opts?: { provider?: unknown; signal?: AbortSignal }
): Promise<TtsServeResult> {
  const key = ttsCacheKey(req, opts?.provider);
  const hit = cache.get(key);
  if (hit) {
    // Re-insert: Map iterates in insertion order, so this is what makes
    // eviction least-recently-USED rather than merely oldest-first.
    cache.delete(key);
    cache.set(key, hit);
    return { audio: hit.audio, cached: true, key };
  }
  const audio = await tts.speak(req, opts);
  store(key, audio);
  return { audio, cached: false, key };
}

/** Entry count and held bytes — for tests and for a future operator surface. */
export function ttsCacheStats(): { entries: number; bytes: number } {
  return { entries: cache.size, bytes: heldBytes };
}

/** Test seam: drop everything held. */
export function resetTtsCacheForTests(): void {
  cache.clear();
  heldBytes = 0;
}
