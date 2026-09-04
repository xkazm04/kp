// The repo's one non-cryptographic string hash.
//
// Two independent FNV-1a implementations lived inside the SAME feature — one in
// app/_lib/group-eval-dedupe.ts (the background-task dedupe key) and one in
// app/features/hiring/decisions/groupEval/cache-key.ts (the selection cache key,
// computed on BOTH the client and the server so the two must agree byte for byte).
// They were written months apart and differed in the loop body (`Math.imul(...)`
// vs `Math.imul(...) >>> 0`), which happens to be digest-identical — XOR and
// `Math.imul` operate on the same 32 bits regardless of how JS signs them — but
// nothing said so, and nothing stopped the next edit to one from silently forking
// a cache key the other half of the same feature still computes the old way.
//
// So: ONE helper, with the digests pinned by hash.test.ts. This module is PURE and
// dependency-free on purpose — the selection cache key is derived in the browser
// as well as on the server (no node:crypto, and this is a cache/dedupe key, never
// a security boundary).

/**
 * 32-bit FNV-1a, lower-case hex, zero-padded to 8 characters.
 *
 * Deterministic across runtimes and STABLE ACROSS RELEASES: its output is baked
 * into persisted `group_evals.role_key` values (`<role>#sel:<n>-<hash>`) and into
 * live background-task dedupe keys, so changing the algorithm silently orphans
 * every cached evaluation. `hash.test.ts` pins concrete digests for exactly that
 * reason — a change there is a cache migration, not a refactor.
 *
 * Hashes UTF-16 code units (`charCodeAt`), not UTF-8 bytes. That is what both
 * call sites already did; it is a valid FNV-1a over that encoding and the inputs
 * (ids, joined with a separator) are ASCII in practice.
 */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply. Math.imul keeps the result in 32-bit range
    // without BigInt; the sign it hands back is irrelevant because only the bit
    // pattern is ever observed (the final `>>> 0` reads it as unsigned).
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
