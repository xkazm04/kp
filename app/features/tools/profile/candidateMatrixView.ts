// Pure view model behind the candidate Board: the archetype lanes, the candidates
// grouped into them, the score distribution each lane summarizes to, and the
// population filters.
//
// The shape it replaced is worth stating, because it is why the grouping exists at
// all. The original matrix was one column per archetype × one row per candidate,
// and every candidate belongs to exactly ONE archetype — so a workspace with 16
// archetypes and 300 candidates drew 4,800 cells to carry 300 facts, 94% of them a
// grey dot, and finding anyone meant scrolling both axes. Grouping the candidates
// under their archetype turns the same data into 16 lanes of ~19, which renders
// with no horizontal axis at all.
//
// React- and next-intl-free so the rules unit-test directly (candidateMatrixView.test.ts);
// the locale-bound pieces (collator locale, label resolver) are passed in.

import { scoreTone } from "@/app/_lib/format";
import { archetypeDisplayKey } from "@/app/_lib/archetypes";
// The sibling roster's search fold. Both surfaces search the SAME candidate names,
// so a name findable in one and invisible in the other is the bug, not the feature.
import { foldForSearch } from "./profileRosterView";
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
 * Archetypes nobody routed to are dropped: an empty lane is a header, a border and
 * a distribution bar that can only ever say "0".
 */
export function groupByArchetype(
  candidates: readonly CandidateRow[],
  columns: readonly ArchetypeColumn[]
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

  return groups.filter((g) => g.candidates.length > 0);
}

/* ── Filtering ──────────────────────────────────────────────────────────────
 * Role family, role and seniority used to be printed INSIDE every candidate
 * card, which is what made the cards wordy: three lines of metadata per person,
 * repeated for hundreds of people, none of it what you scan for. They are
 * questions about the POPULATION ("show me the senior engineers"), not facts you
 * read one candidate at a time — so they belong in a filter bar above the view
 * and in the per-candidate detail modal, not on the card. */

export type CandidateFilters = {
  /** Free text over the candidate name. */
  q: string;
  /** Role-family wire value — "" means all. */
  family: string;
  /** Seniority wire value — "" means all. */
  seniority: string;
  /** "profile" | "analysis" — which store the candidate came from; "" means all. */
  source: string;
};

export const NO_CANDIDATE_FILTERS: CandidateFilters = { q: "", family: "", seniority: "", source: "" };

/** True when nothing is narrowing the population — lets a caller tell "no results"
 *  from "no candidates" without re-deriving the predicate. */
export function hasActiveFilters(f: CandidateFilters): boolean {
  return Boolean(f.q.trim() || f.family || f.seniority || f.source);
}

export function filterCandidates(
  candidates: readonly CandidateRow[],
  filters: CandidateFilters
): CandidateRow[] {
  const needle = foldForSearch(filters.q.trim());
  return candidates.filter((c) => {
    if (needle && !foldForSearch(c.name).includes(needle)) return false;
    if (filters.family && c.role !== filters.family) return false;
    if (filters.seniority && c.seniority !== filters.seniority) return false;
    if (filters.source && c.source !== filters.source) return false;
    return true;
  });
}

/** Options for the filter bar — only values actually present in the population,
 *  so a menu can never offer a filter that yields nothing. Sorted through the
 *  caller's collator: a plain .sort() puts Č/Ř/Š/Ž after Z, which reads as broken
 *  in cs. Seniority keeps its LADDER order (junior → lead) rather than being
 *  alphabetized — it is a scale, and sorting a scale alphabetically hides that. */
export const SENIORITY_ORDER: readonly string[] = ["junior", "medior", "senior", "lead"];

export function candidateFacets(
  candidates: readonly CandidateRow[],
  opts: { locale: string; label: (group: string, slug: string) => string }
): { families: { value: string; label: string }[]; seniorities: { value: string; label: string }[] } {
  const collator = new Intl.Collator(opts.locale);
  const families = [...new Set(candidates.map((c) => c.role).filter((r): r is string => Boolean(r)))]
    .map((value) => ({ value, label: opts.label("family", value) }))
    .sort((a, b) => collator.compare(a.label, b.label));

  const present = new Set(candidates.map((c) => c.seniority).filter((s): s is string => Boolean(s)));
  const known = SENIORITY_ORDER.filter((s) => present.has(s));
  // Anything the ladder doesn't know about still has to be filterable — it just
  // sorts after the ladder rather than being silently dropped.
  const unknown = [...present].filter((s) => !SENIORITY_ORDER.includes(s)).sort(collator.compare);
  const seniorities = [...known, ...unknown].map((value) => ({ value, label: opts.label("seniority", value) }));

  return { families, seniorities };
}
