// History triage (challenge-r09 cv-analyze-workspace/B): the pure half of the drawer
// that walks the runs a recruiter still owes a decision on, without leaving the list.
//
// Deciding used to mean leaving History for /history/<slug>, deciding there, and
// coming back to a list whose filter state was gone. The drawer mounts the SAME
// DispositionEditor against the SAME PATCH /api/analyses/[slug] (acknowledgement gate
// + compare-and-swap), so a triage decision is the report's decision, never a second
// write path. What lives here is only what the list does with a decision that landed:
// which row is next, how the row repaints, and what the header may claim.
import type { AnalysisRow } from "./HistoryTypes";

export type TriageMode = "undecided" | "all";

/** The dispositions the store keeps; anything else is written as a clear (NULL). */
const STORED_DISPOSITIONS = new Set(["advance", "hold", "pass"]);

/** A row with no recorded decision: NULL or '' (the server's 'undecided' filter). */
export const isUndecided = (row: Pick<AnalysisRow, "disposition">): boolean => !row.disposition;

/** The slugs to walk, in the list's display order. */
export function triageQueue(rows: readonly AnalysisRow[], mode: TriageMode): string[] {
  return rows.filter((r) => mode === "all" || isUndecided(r)).map((r) => r.slug);
}

/** The queue the open drawer navigates: the mode's queue, with the row on screen kept in
 *  its display position even once it is decided, so prev/next stay anchored to it. */
export function triageQueueAround(rows: readonly AnalysisRow[], mode: TriageMode, current: string | null): string[] {
  return rows.filter((r) => r.slug === current || mode === "all" || isUndecided(r)).map((r) => r.slug);
}

/** One step through the queue. No wrap: past either end is null. */
export function stepTriage(queue: readonly string[], current: string, dir: 1 | -1): string | null {
  const i = queue.indexOf(current);
  if (i < 0) return null;
  return queue[i + dir] ?? null;
}

/** Where the drawer goes after `slug` was decided: the next row the mode still walks.
 *  Null is the "all decided" state, never a wrap back to the top. Works on the rows
 *  before or after the decision was applied. */
export function afterDecision(rows: readonly AnalysisRow[], slug: string, mode: TriageMode): string | null {
  return stepTriage(triageQueueAround(rows, mode, slug), slug, 1);
}

export type TriageDecision = { disposition: string; note: string };

/** Repaint one row with a decision the server accepted, normalised the way
 *  writeDisposition stores it (analyses.ts): an unknown or empty disposition clears
 *  both fields, and a note is kept trimmed only beside a real disposition. Returns the
 *  SAME array when nothing changes, and new objects only for the decided row. */
export function applyDecision(rows: AnalysisRow[], slug: string, decision: TriageDecision): AnalysisRow[] {
  const i = rows.findIndex((r) => r.slug === slug);
  if (i < 0) return rows;
  const disposition = STORED_DISPOSITIONS.has(decision.disposition) ? decision.disposition : null;
  const decision_note = disposition && decision.note.trim() ? decision.note.trim() : null;
  const prev = rows[i];
  if ((prev.disposition || null) === disposition && (prev.decision_note ?? null) === decision_note) return rows;
  const next = rows.slice();
  next[i] = { ...prev, disposition, decision_note };
  return next;
}

/** Keep only the rows the active decision filter still matches. Run when the drawer
 *  closes: while it is open a decided row stays on screen (its pill repaints), and
 *  afterwards the list answers its own filter again, as a refetch would. */
export function pruneToFilter(rows: AnalysisRow[], disposition: string): AnalysisRow[] {
  if (!disposition) return rows;
  const keep = rows.filter((r) => (disposition === "undecided" ? isUndecided(r) : r.disposition === disposition));
  return keep.length === rows.length ? rows : keep;
}

/** j = next, k = prev. Null while the focus is in a text field: typing a reason never
 *  skips a candidate. */
export function triageKey(key: string, typing: boolean): "next" | "prev" | null {
  if (typing) return null;
  if (key === "j") return "next";
  if (key === "k") return "prev";
  return null;
}

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"]);

/** Whether a keydown target is a place the recruiter types (a checkbox is not). */
export function isTypingTarget(
  el: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined
): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return tag === "INPUT" && !NON_TEXT_INPUTS.has((el.type ?? "text").toLowerCase());
}

/** What the drawer header may claim. `ofLoaded` is true when the list is a window (more
 *  runs match than are loaded): the counts then describe the loaded rows, never a
 *  workspace total. */
export function triageProgress(rows: readonly AnalysisRow[], truncated: boolean) {
  const undecided = rows.filter(isUndecided).length;
  return { undecided, decided: rows.length - undecided, ofLoaded: truncated };
}

/** The outcome DispositionEditor reports for every settled save. */
export type SaveOutcome = { ok: boolean; code?: string | null };

/** Only a save the server accepted repaints the list or moves the cursor. A refused
 *  save (DISPOSITION_ACK_REQUIRED, a viewer seat's 403, a network failure) leaves the
 *  row as it was and the drawer on that analysis, its open flags in view. */
export function shouldApplySave(outcome: SaveOutcome): boolean {
  return outcome.ok === true;
}
