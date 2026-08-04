import { createHash } from "node:crypto";

// In-process TTL cache for the deep-dive (GH5), mirroring the matrix route's
// content-hash cache (same accepted single-process caveat). Each run burns up
// to ~31 GitHub REST calls + one Gemini call, and GitHub's anonymous 60/hr
// rate limit is the route's dominant real-world failure — re-analyzing the
// same candidate within the TTL serves the stored result (with its original
// analyzedAt) instead of burning another budget. Errors are never cached, so
// a rate-limited attempt can be retried immediately.
const GITHUB_CACHE_TTL_MS = 15 * 60 * 1000;
const GITHUB_CACHE_MAX = 20;
const githubCache = new Map<string, { at: number; payload: unknown }>();

// GitHub usernames are case-insensitive — fold the key so Octocat and octocat
// share an entry. The JD is part of the key because jobFitSignals depend on it.
// The JD is NORMALIZED (case/whitespace folded, length-capped) for the key ONLY —
// the analysis still runs against the raw JD. Without this, a trivial JD variation
// (file-extracted vs typed, an extra space, padding) produced a fresh key and turned
// each miss into ~31 GitHub calls + a paid Gemini call: a cheap cost-amplifier.
const GITHUB_CACHE_JD_KEY_MAX = 4000;
export function githubCacheKey(username: string, jobDescription: string): string {
  const normJd = jobDescription.toLowerCase().replace(/\s+/g, " ").trim().slice(0, GITHUB_CACHE_JD_KEY_MAX);
  return createHash("sha1").update(`${username.toLowerCase()}\n${normJd}`).digest("hex");
}

/** The cached payload for `key`, or undefined on a miss. An expired entry is
 *  dropped on read, so a stale result can never be served. */
export function readGithubCache(key: string): unknown | undefined {
  const hit = githubCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at < GITHUB_CACHE_TTL_MS) return hit.payload;
  githubCache.delete(key);
  return undefined;
}

/** Store a successful analysis and evict the oldest entry past the cap. Only
 *  successes are ever written — an error must stay retryable immediately. */
export function writeGithubCache(key: string, payload: unknown): void {
  githubCache.set(key, { at: Date.now(), payload });
  if (githubCache.size > GITHUB_CACHE_MAX) {
    // Map iterates in insertion order — drop the oldest entry.
    const oldest = githubCache.keys().next().value;
    if (oldest) githubCache.delete(oldest);
  }
}
