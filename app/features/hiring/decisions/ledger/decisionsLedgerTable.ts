// The decisions ledger's table grammar over its rows — pure, so filtering and the
// grouped ordering are unit-tested beside the row model.
//
// GROUPS STAY WHOLE under any sort. The rows are sorted by the active column, then
// folded by role in the order each role FIRST appears in that sort: sorting by score
// therefore ranks the roles by their best row and keeps every role's shortlist
// together, best first; sorting by role orders the groups A→Z (or Z→A) and keeps
// the rows inside a group in their own order. Paging happens over the flat grouped
// sequence, so a page never splits a role's header from its first row.

import type { LedgerGroup, LedgerRow } from "./decisionsLedgerModel";

export type LedgerFilters = { name: string; role: string; stage: string; recommended: string };
export const EMPTY_FILTERS: LedgerFilters = { name: "", role: "", stage: "", recommended: "" };

/** What the "AI recommends" filter matches on: the verdict, or "offer" for a priced draft. */
export function proposalKey(row: LedgerRow): string {
  return row.offer ? "offer" : (row.recommendation ?? "");
}

export function filterLedgerRows(rows: readonly LedgerRow[], f: LedgerFilters): LedgerRow[] {
  const q = f.name.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (!q || r.entry.candidateLabel.toLowerCase().includes(q)) &&
      (!f.role || (r.entry.jobId ?? r.entry.jobTitle ?? "?") === f.role) &&
      (!f.stage || r.entry.stage === f.stage) &&
      (!f.recommended || proposalKey(r) === f.recommended),
  );
}

export function isFiltering(f: LedgerFilters): boolean {
  return Boolean(f.name.trim() || f.role || f.stage || f.recommended);
}

/** Fold SORTED rows by role, keeping the sort inside each group and ordering the
 *  groups by their first appearance. Returns the flat grouped sequence too, which is
 *  what the pager slices. */
export function groupKeepingOrder(sorted: readonly LedgerRow[]): { groups: LedgerGroup[]; flat: LedgerRow[] } {
  const byKey = new Map<string, LedgerGroup>();
  for (const row of sorted) {
    const key = row.entry.jobId ?? row.entry.jobTitle ?? "?";
    let g = byKey.get(key);
    if (!g) {
      g = { key, title: row.entry.jobTitle ?? "", rows: [], best: null };
      byKey.set(key, g);
    }
    g.rows.push(row);
    if (row.score != null && (g.best == null || row.score > g.best)) g.best = row.score;
  }
  const groups = [...byKey.values()];
  return { groups, flat: groups.flatMap((g) => g.rows) };
}

/** Re-fold a PAGE of the flat grouped sequence into groups (contiguous by construction). */
export function groupPage(page: readonly LedgerRow[]): LedgerGroup[] {
  return groupKeepingOrder(page).groups;
}
