// The one canonical definition of "the same CV variant", shared by BOTH intake
// paths — the client (addCvFile in useAnalyzeForm) and the server
// (collectCvFiles in /api/analyze) — so the two sides can't disagree about which
// uploads are duplicates.
//
// Before this, the two paths used different, mutually contradictory rules:
//   • client addCvFile merged by name === name && size === size — so two
//     genuinely DIFFERENT CVs that happened to share a filename and byte length
//     were silently collapsed into one (a distinct variant lost).
//   • server collectCvFiles never deduped content at all — so the SAME file
//     added twice both ran, hit the same analyze cache key, and let
//     buildComparison rank an identical clone against itself (a wasted run).
//
// Identity is the file's CONTENT: a SHA-256 hex digest of its bytes. A content
// hash collides only when the bytes are byte-for-byte identical, which is
// exactly what "same variant" should mean — it neither over-merges distinct
// files (the client bug) nor under-merges true duplicates (the server gap). It
// also lines up with the analyze cache key, which already keys on the raw CV
// bytes (see cache-key.ts), so "same variant" and "same cache entry" stay the
// same question.
//
// Uses the Web Crypto API (crypto.subtle) — not node:crypto — so this single
// helper runs unchanged in the browser and in the Node route handler. (The
// cache key stays on node:crypto because it is server-only.)

/** SHA-256 hex digest of a file's bytes — the canonical CV-variant identity. */
export async function cvVariantHash(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Drop content-duplicate files, keeping the first occurrence of each distinct
 * variant in input order. Used by the server intake to collapse the same upload
 * sent twice before it is labeled and analyzed. Genuinely different files are
 * kept even when their display names collide — only true byte clones are removed.
 */
export async function dedupeCvVariants<T extends Blob>(files: T[]): Promise<T[]> {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const file of files) {
    const id = await cvVariantHash(file);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(file);
  }
  return out;
}

/**
 * True when `candidate` is the same variant (same content) as one already in
 * `existing`, regardless of filename. Used by the client intake to reject
 * re-adding a CV the form already holds.
 */
export async function isDuplicateCvVariant(candidate: Blob, existing: Blob[]): Promise<boolean> {
  const id = await cvVariantHash(candidate);
  for (const file of existing) {
    if ((await cvVariantHash(file)) === id) return true;
  }
  return false;
}
