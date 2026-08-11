// Pure view model shared by every candidate-matrix variant: the archetype columns
// and the candidates grouped under them, with the score distribution each group
// summarizes to.
//
// The baseline table's shape is the thing being fixed here. It renders one column
// per archetype × one row per candidate, and every candidate belongs to exactly ONE
// archetype — so a workspace with 16 archetypes and 300 candidates draws 4,800 cells
// to carry 300 facts, 94% of them a grey dot. The recruiter then has to scroll BOTH
// axes to find anyone. Grouping the candidates under their archetype (below) turns
// the same data into 16 groups of ~19, which both variants can render without a
// horizontal axis at all.

import { scoreTone } from "@/app/_lib/format";
import { archetypeDisplayKey } from "@/app/_lib/archetypes";
import type { ArchetypeDef, CandidateRow } from "@/app/features/shared/profileTypes";

/** The score bands the distribution bar splits a group into — the SAME 75/50
 *  cutoffs ScoreBadge uses (scoreTone), so a bar segment and the badges under it
 *  can never disagree about who counts as strong. */
export type Band = "strong" | "mid" | "weak" | "unscored";
export const BANDS: readonly Band[] = ["strong", "mid", "weak", "unscored"];

export type ArchetypeColumn = { id: string; label: string; archived: boolean };

export type ArchetypeGroup = ArchetypeColumn & {
  candidates: CandidateRow[];
  /** Candidate count per band; the four sum to candidates.length. */
  bands: Record<Band, number>;
};

/** Which band a candidate falls in. A profile-sourced candidate has no score —
 *  that is "not yet assessed", NOT a zero, so it gets its own band rather than
 *  being lumped in with the weak fits. */
export function bandOf(candidate: CandidateRow): Band {
  const tone = scoreTone(candidate.score);
  return tone === "null" ? "unscored" : tone;
}

/**
 * The archetype columns to render: the registry's archetypes, plus any archetype
 * that appears on a candidate but isn't (or no longer is) in the registry — mapped
 * through archetypeDisplayKey so the fail-closed "unknown" sentinel folds into a
 * single honest "Unrouted" column instead of a raw "unknown" one, and no candidate
 * is dropped. Retired archetypes still score, so a retired column that HAS
 * candidates stays (flagged); an EMPTY one is pruned as dead chrome.
 */
export function archetypeColumns(
  archetypes: readonly ArchetypeDef[],
  candidates: readonly CandidateRow[],
  archivedArchetypeIds: readonly string[] = []
): ArchetypeColumn[] {
  const archived = new Set(archivedArchetypeIds);
  const usedKeys = new Set(candidates.map((c) => archetypeDisplayKey(c.archetype)));
  const cols = archetypes
    .filter((a) => !archived.has(a.id) || usedKeys.has(a.id))
    .map((a) => ({ id: a.id, label: a.label, archived: archived.has(a.id) }));
  const known = new Set(cols.map((c) => c.id));
  const extra = [...new Set(candidates.map((c) => archetypeDisplayKey(c.archetype)).filter((id) => !known.has(id)))];
  return [...cols, ...extra.map((id) => ({ id, label: id, archived: false }))];
}

/**
 * Candidates grouped under their archetype, strongest first within each group.
 *
 * `emptyGroups: false` drops archetypes nobody routed to — the right default for
 * the detail-on-demand variants, where an empty group is a tile that can only ever
 * say "0". Pass true when the caller genuinely wants the whole taxonomy shown
 * (e.g. a coverage read: "which archetypes have we sourced nobody for?").
 */
export function groupByArchetype(
  candidates: readonly CandidateRow[],
  columns: readonly ArchetypeColumn[],
  opts: { emptyGroups?: boolean } = {}
): ArchetypeGroup[] {
  const byId = new Map<string, CandidateRow[]>(columns.map((c) => [c.id, []]));
  for (const cand of candidates) {
    const key = archetypeDisplayKey(cand.archetype);
    // A candidate whose archetype produced no column would silently vanish;
    // archetypeColumns is built to make that impossible, but grouping defensively
    // keeps this function honest for any caller that passes its own columns.
    if (!byId.has(key)) byId.set(key, []);
    byId.get(key)!.push(cand);
  }

  const groups = columns.map((col) => {
    // Strongest first, then by name so equal/absent scores hold a stable order.
    const rows = [...(byId.get(col.id) ?? [])].sort(
      (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name)
    );
    const bands: Record<Band, number> = { strong: 0, mid: 0, weak: 0, unscored: 0 };
    for (const c of rows) bands[bandOf(c)] += 1;
    return { ...col, candidates: rows, bands };
  });

  return opts.emptyGroups ? groups : groups.filter((g) => g.candidates.length > 0);
}

/** The group a variant should open on: the biggest one, so the first screen shows
 *  the map AND a real cohort rather than an empty "pick something above" panel.
 *  Ties break on column order, which is the registry's own ordering. */
export function largestGroupId(groups: readonly ArchetypeGroup[]): string | null {
  let best: ArchetypeGroup | null = null;
  for (const g of groups) if (!best || g.candidates.length > best.candidates.length) best = g;
  return best?.id ?? null;
}
