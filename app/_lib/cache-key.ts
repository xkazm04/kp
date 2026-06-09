import crypto from "node:crypto";

// Pure, dependency-free analyze cache-key derivation. Split out of cache.ts (no
// `./db` import) so the hashing contract can be exercised directly by Node's
// built-in test runner — see cache-key.test.ts. cache.ts re-exports these so
// existing importers keep resolving them from "./cache".

// Bump this when the Gemini prompt, the Pydantic schema, the deterministic
// pre-pass, or the taxonomy changes in a way that should invalidate prior
// results. Hashes from older versions automatically miss the cache.
//
// This is the single source of truth for the analyze cache key — the cache is
// computed and stored entirely on the Node side, so there is no Python
// counterpart to keep in sync. (The reasoning cache has its own version that
// DOES mirror a Python constant; that pair is guarded by
// pipeline/jobfit/tests/test_prompt_version_sync.py.)
//
// v4 bumps the key for the length-framed serialization below (idea-c2c4b498):
// the prior delimiter-only key could collide across field boundaries, so every
// old hash must miss and be recomputed under the unambiguous framing.
//
// v5 adds the output `lang` to the key: the same CV now analyzes to a different
// (localized) narrative per locale, so an en result must NOT be served for a cs
// request and vice-versa. Mixing them would show English narrative under a Czech
// UI (or stale-cache the wrong language). Bumping invalidates every pre-i18n hash.
export const PROMPT_VERSION = "v5-2026-06-09-lang-cachekey";

export type CacheKeyInput = {
  cvBytes: Buffer;
  jobDescriptionText: string;
  jobDescriptionFileBytes: Buffer | null;
  companyText: string;
  companyFileBytes: Buffer | null;
  grounding: boolean;
  // Output locale the narrative was generated in ("en" | "cs"). Part of the key
  // so localized results don't collide — see the v5 note above.
  lang: string;
};

export function computeCacheKey(input: CacheKeyInput): string {
  const h = crypto.createHash("sha256");
  // Length-frame every field as [8-byte big-endian byte length][bytes] before
  // hashing (idea-c2c4b498). The old key concatenated fields with literal
  // markers like `|jdt=`/`|cot=` and no length, so content containing one of
  // those markers could shift bytes across a field boundary and make two
  // genuinely different inputs hash identically — serving one candidate's
  // analysis for another's. Framing makes the input→key mapping unambiguous: a
  // field's bytes can never be confused with a neighbor's because its exact
  // length is committed first. Order is fixed and part of the contract.
  const field = (value: string | Buffer | boolean): void => {
    const buf =
      typeof value === "boolean"
        ? Buffer.from(value ? "1" : "0", "utf-8")
        : typeof value === "string"
          ? Buffer.from(value, "utf-8")
          : value;
    const len = Buffer.alloc(8);
    len.writeBigUInt64BE(BigInt(buf.length));
    h.update(len);
    h.update(buf);
  };
  field(PROMPT_VERSION);
  field(input.grounding);
  field(input.lang);
  field(input.jobDescriptionText.trim());
  field(input.jobDescriptionFileBytes ?? Buffer.alloc(0));
  field(input.companyText.trim());
  field(input.companyFileBytes ?? Buffer.alloc(0));
  field(input.cvBytes);
  return h.digest("hex");
}
