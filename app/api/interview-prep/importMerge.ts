// Pure helpers for the interview-kit → prep-pack import (Direction 2). Kept in a
// next/server-free module so the idempotency contract is unit-testable without the
// worktree NextRequest artifact that breaks importing the route itself.

// A report's interview kit is a handful of questions; bound both the count and each
// string so a crafted body can't balloon the persisted artifact payload.
export const MAX_IMPORT_QUESTIONS = 40;
export const MAX_IMPORT_QUESTION_LEN = 2000;

/** Normalize an untrusted request body's `questions` into clean, bounded strings:
 *  keep only strings, trim, cap length, drop blanks. */
export function normalizeIncoming(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw
        .filter((q): q is string => typeof q === "string")
        .map((q) => q.trim().slice(0, MAX_IMPORT_QUESTION_LEN))
        .filter((q) => q.length > 0)
    : [];
}

/** Read the current imported-questions list off a prep payload, defensively (a
 *  hand-edited or older payload may carry a non-array / non-string value). */
export function readImported(payload: Record<string, unknown>): string[] {
  const raw = payload.importedQuestions;
  return Array.isArray(raw) ? raw.filter((q): q is string => typeof q === "string") : [];
}

/** Merge freshly-imported questions onto the ones already stored, deduped by exact
 *  content and capped. Pure so the idempotency contract (re-importing the same kit
 *  is a no-op — the duplicate-import guard) is unit-testable. Order-preserving:
 *  prior questions keep their positions, new ones append. */
export function mergeImportedQuestions(prior: string[], incoming: string[], cap = MAX_IMPORT_QUESTIONS): string[] {
  const seen = new Set(prior);
  const merged = [...prior];
  for (const q of incoming) {
    if (merged.length >= cap) break;
    if (!seen.has(q)) {
      seen.add(q);
      merged.push(q);
    }
  }
  return merged;
}
