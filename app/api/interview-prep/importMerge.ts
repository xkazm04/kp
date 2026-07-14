// Pure helpers for the interview-kit → prep-pack import (Direction 2) and the
// "weave an imported question into the plan" action (Direction 3). Kept in a
// next/server-free module so the idempotency + weaving contracts are unit-testable
// without the worktree NextRequest artifact that breaks importing the route itself.

// A report's interview kit is a handful of questions; bound both the count and each
// string so a crafted body can't balloon the persisted artifact payload.
export const MAX_IMPORT_QUESTIONS = 40;
export const MAX_IMPORT_QUESTION_LEN = 2000;
// A blockRef is a chronology block's topic — a short label, never a document.
export const MAX_BLOCK_REF_LEN = 200;

// Direction 3 — an imported question is either a legacy plain string OR a
// { question, blockRef? } entry. `blockRef` names the chronology block it's woven
// into (by the block's topic). ONE key, both sides read: the voice brief reads
// importedQuestions, and extending entries with blockRef keeps a woven question in
// its single home (importedQuestions) rather than duplicating it into the
// generator-owned chronology, which Regenerate would wipe. The modal renders a
// blockRef'd entry INSIDE its block; unassigned ones stay in the imported section.
export type ImportedQuestionEntry = { question: string; blockRef?: string };
export type ImportedQuestion = string | ImportedQuestionEntry;

/** Normalize an untrusted request body's `questions` into clean, bounded strings:
 *  keep only strings, trim, cap length, drop blanks. The import POST accepts plain
 *  strings only (a report kit is unassigned reference material until woven). */
export function normalizeIncoming(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw
        .filter((q): q is string => typeof q === "string")
        .map((q) => q.trim().slice(0, MAX_IMPORT_QUESTION_LEN))
        .filter((q) => q.length > 0)
    : [];
}

/** Normalize ONE stored importedQuestions element — a legacy plain string or a
 *  { question, blockRef? } object — to the canonical entry shape, or null if it
 *  carries no usable question. Defensive at the read boundary: a hand-edited or
 *  older payload may mix both shapes or carry junk. */
export function normalizeImportedEntry(raw: unknown): ImportedQuestionEntry | null {
  if (typeof raw === "string") {
    const q = raw.trim();
    return q ? { question: q } : null;
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const q = typeof o.question === "string" ? o.question.trim() : "";
    if (!q) return null;
    const blockRef = typeof o.blockRef === "string" && o.blockRef.trim() ? o.blockRef.trim().slice(0, MAX_BLOCK_REF_LEN) : undefined;
    return blockRef ? { question: q, blockRef } : { question: q };
  }
  return null;
}

/** Read importedQuestions as canonical entries, tolerating legacy plain strings, a
 *  mixed array, and a missing/malformed key (→ []). This is the shape the merge +
 *  weave helpers operate on, so both the plain-string import path and the
 *  blockRef'd weave path share one representation. */
export function readImportedEntries(payload: Record<string, unknown>): ImportedQuestionEntry[] {
  const raw = payload.importedQuestions;
  if (!Array.isArray(raw)) return [];
  const out: ImportedQuestionEntry[] = [];
  for (const el of raw) {
    const e = normalizeImportedEntry(el);
    if (e) out.push(e);
  }
  return out;
}

/** Back-compat: the plain-question strings of a payload's imported entries (drops
 *  blockRefs). Retained for callers/copy paths that only need the text. */
export function readImported(payload: Record<string, unknown>): string[] {
  return readImportedEntries(payload).map((e) => e.question);
}

/** Merge freshly-imported questions onto the entries already stored, deduped by
 *  exact question content and capped. Pure so the idempotency contract (re-importing
 *  the same kit is a no-op) is unit-testable. Order-preserving: prior entries keep
 *  their positions AND their blockRefs (a re-import never un-weaves a woven
 *  question), new ones append as unassigned {question}. */
export function mergeImportedQuestions(
  prior: ImportedQuestionEntry[],
  incoming: string[],
  cap = MAX_IMPORT_QUESTIONS
): ImportedQuestionEntry[] {
  const seen = new Set(prior.map((e) => e.question));
  const merged = [...prior];
  for (const q of incoming) {
    if (merged.length >= cap) break;
    if (!seen.has(q)) {
      seen.add(q);
      merged.push({ question: q });
    }
  }
  return merged;
}

/** Weave an imported question into a chronology block — or unassign it when
 *  `blockRef` is null/blank — by content-matching it in the entries. The single-home
 *  model: the question stays in importedQuestions and only gains/loses a blockRef, so
 *  it is never duplicated into the generator-owned chronology (which Regenerate would
 *  wipe) and the voice brief reading importedQuestions sees the one key. Pure +
 *  idempotent; returns the entries unchanged when the question isn't found. */
export function assignImportedBlock(
  entries: ImportedQuestionEntry[],
  question: string,
  blockRef: string | null
): ImportedQuestionEntry[] {
  const ref = blockRef && blockRef.trim() ? blockRef.trim().slice(0, MAX_BLOCK_REF_LEN) : null;
  return entries.map((e) => (e.question === question ? (ref ? { question: e.question, blockRef: ref } : { question: e.question }) : e));
}
