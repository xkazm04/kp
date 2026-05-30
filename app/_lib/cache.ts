import crypto from "node:crypto";
import { lookupGeminiCache, storeGeminiCache } from "./db";

// Bump this when the Gemini prompt, the Pydantic schema, the deterministic
// pre-pass, or the taxonomy changes in a way that should invalidate prior
// results. Hashes from older versions automatically miss the cache.
//
// This is the single source of truth for the analyze cache key — the cache is
// computed and stored entirely on the Node side, so there is no Python
// counterpart to keep in sync. (The reasoning cache has its own version that
// DOES mirror a Python constant; that pair is guarded by
// pipeline/jobfit/tests/test_prompt_version_sync.py.)
export const PROMPT_VERSION = "v3-2026-05-31-archetype";

const TTL_HOURS = (() => {
  const raw = process.env.KP_CACHE_TTL_HOURS;
  if (!raw) return 24;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
})();

export type CacheKeyInput = {
  cvBytes: Buffer;
  jobDescriptionText: string;
  jobDescriptionFileBytes: Buffer | null;
  companyText: string;
  companyFileBytes: Buffer | null;
  grounding: boolean;
};

export function computeCacheKey(input: CacheKeyInput): string {
  const h = crypto.createHash("sha256");
  h.update("v=", "utf-8");
  h.update(PROMPT_VERSION, "utf-8");
  h.update("|g=", "utf-8");
  h.update(input.grounding ? "1" : "0", "utf-8");
  h.update("|jdt=", "utf-8");
  h.update(input.jobDescriptionText.trim(), "utf-8");
  h.update("|jdf=", "utf-8");
  if (input.jobDescriptionFileBytes) h.update(input.jobDescriptionFileBytes);
  h.update("|cot=", "utf-8");
  h.update(input.companyText.trim(), "utf-8");
  h.update("|cof=", "utf-8");
  if (input.companyFileBytes) h.update(input.companyFileBytes);
  h.update("|cv=", "utf-8");
  h.update(input.cvBytes);
  return h.digest("hex");
}

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
