import { createHash } from "node:crypto";
import { validateRequest } from "@/packages/voice-tts/src/index";
import type { ServedTtsAudio, Tts, TtsRequest } from "@/packages/voice-tts/src/index";

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

/** Re-exported from the package: what was served, plus HOW (the provider it fell
 *  back from, the language nothing could speak). Both facts are cached with the
 *  bytes, so a replay repeats the same honest claim rather than a cleaner one. */
export type { ServedTtsAudio };

/** Just the method this module needs, so a test can hand it a double without
 *  building a registry (and so nothing here can reach an engine by accident). */
export type TtsSpeaker = Pick<Tts, "speak">;

type Entry = { audio: ServedTtsAudio; bytes: number };

const cache = new Map<string, Entry>();
let heldBytes = 0;
/**
 * THE SECOND PRESS INSIDE THE FIRST SYNTHESIS PAID TOO.
 *
 * The cache only ever held FINISHED clips, so two requests for the same
 * utterance that overlapped - auto-speak plus the operator pressing play while
 * the first call is still in flight, a double click, two tabs on one thread -
 * both missed, both reached the engine, and the second one's bytes overwrote
 * the first's. A promise-valued entry closes that window: the second caller
 * awaits the first call instead of making its own. A REJECTED promise is
 * evicted (the `finally` below), so a failure is never remembered as a result
 * and the next caller gets a real attempt.
 *
 * The abort caveat, stated rather than hidden: the engine call carries the
 * FIRST caller's signal, so a joiner inherits that caller's abort. The window is
 * one synthesis long, the alternative is paying twice, and the joiner sees a
 * typed `aborted` rather than a wrong clip.
 */
const inflight = new Map<string, Promise<ServedTtsAudio>>();

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
  // KEYED ON WHAT THE ENGINE WILL ACTUALLY RECEIVE. The raw body used to be the
  // key, so two requests that the validation door collapses into ONE synthesis
  // (speed 3 and speed 2 — it clamps at 2; "CS-cz" and "cs-cz"; a chat reply
  // with and without its markdown) missed each other and paid twice. A request
  // that does NOT validate keeps its raw shape: it is refused before an engine
  // sees it, nothing is ever stored under that key, and keying it raw is what
  // keeps it from colliding with a real clip.
  let keyed = req;
  try {
    keyed = validateRequest(req);
  } catch {
    /* invalid: refused downstream by the same door, and never stored — see above */
  }
  const digest = createHash("sha256").update(normalizeText(keyed.text ?? ""), "utf8").digest("hex");
  const parts = [
    typeof provider === "string" && provider ? provider : "auto",
    keyed.voiceId ?? "",
    keyed.language ?? "",
    keyed.speed == null ? "" : String(keyed.speed),
    keyed.format ?? "",
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
  const hit = ttsCacheLookup(req, opts);
  if (hit) return hit;
  // Already being synthesized: join it rather than start a second one.
  const pending = inflight.get(key);
  if (pending) return { audio: await pending, cached: true, key };
  const call = tts.speak(req, opts);
  inflight.set(key, call);
  try {
    const audio = await call;
    store(key, audio);
    return { audio, cached: false, key };
  } finally {
    // Both outcomes: a resolved call is now IN the cache, and a rejected one
    // must not be handed to the next caller as a result.
    inflight.delete(key);
  }
}

/**
 * The REPLAY half, with no engine anywhere near it.
 *
 * Split out so a host can answer a hit before it charges anything: /api/tts's
 * per-IP limiter guards SYNTHESIS (money on the cloud path, a spawned sidecar on
 * the local one), and replaying bytes the process already holds spends neither,
 * so charging a replay just shortened the window for the calls that do cost.
 * Never throws — an unvalidatable request has no cached clip by construction, so
 * it reports a miss and the caller's normal path refuses it with its own code.
 */
export function ttsCacheLookup(req: TtsRequest, opts?: { provider?: unknown }): TtsServeResult | null {
  const key = ttsCacheKey(req, opts?.provider);
  const hit = cache.get(key);
  if (!hit) return null;
  // Re-insert: Map iterates in insertion order, so this is what makes
  // eviction least-recently-USED rather than merely oldest-first.
  cache.delete(key);
  cache.set(key, hit);
  return { audio: hit.audio, cached: true, key };
}

/** Entry count and held bytes — for tests and for a future operator surface. */
export function ttsCacheStats(): { entries: number; bytes: number } {
  return { entries: cache.size, bytes: heldBytes };
}

/** Test seam: drop everything held. */
export function resetTtsCacheForTests(): void {
  cache.clear();
  inflight.clear();
  heldBytes = 0;
}
