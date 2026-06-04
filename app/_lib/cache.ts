import { lookupGeminiCache, storeGeminiCache } from "./db";
import { positiveNumericEnv } from "./env";
import { PROMPT_VERSION } from "./cache-key";

// The pure key derivation lives in ./cache-key (no DB import, unit-testable).
// Re-exported here so existing importers keep resolving it from "./cache".
export { computeCacheKey, PROMPT_VERSION, type CacheKeyInput } from "./cache-key";

const TTL_HOURS = positiveNumericEnv("KP_CACHE_TTL_HOURS", 24);

export function lookupCachedAnalysis(hash: string): unknown | null {
  try {
    return lookupGeminiCache(hash, PROMPT_VERSION);
  } catch (error) {
    console.error("gemini cache lookup failed", error);
    return null;
  }
}

export function storeCachedAnalysis(hash: string, payload: unknown): void {
  try {
    storeGeminiCache(hash, payload, PROMPT_VERSION, TTL_HOURS);
  } catch (error) {
    console.error("gemini cache write failed", error);
  }
}
