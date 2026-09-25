// The /me flow's derived facts — pure, no React, no fetch, so `node --test` pins them.
//
// Everything the Sieve draws is RE-DERIVED from the rows on every render, never kept
// as a counter beside them: the rail's "98 through", the sieve's layer counts, the top
// five and the rail bars all come out of `deriveSieve`, so a decision written to a row
// moves every number that depends on it (the winner's "verdict moves the number").
//
// The five places a posting can stand, in the order the sieve draws them:
//   held     its source is switched off or paused — not in your sieve until it is back on
//   gated    a hard gate removed it — it names the gate and keeps an as-if score, never 0
//   waiting  structured but not scored yet — honest absence, not a low score
//   scored   ranked by total, ties broken by the tighter band (the surer score first)
// …and `gone` rows stay in the scored field drawn hollow, because the seeker may have
// decided on them before they went away.

import type { FitTier, JobseekerPostingSummary, JobseekerSource, KoReasonKey, PostingStatus, WorkMode } from "@/app/_lib/jobseeker/types";

export type SievePosting = JobseekerPostingSummary;

/** A source feeds the sieve only while it is enabled and not paused. */
export function sourceIsOn(source: Pick<JobseekerSource, "enabled" | "pausedReason"> | undefined): boolean {
  return !!source && source.enabled && source.pausedReason === null;
}

export type SieveFacts = {
  all: SievePosting[];
  held: SievePosting[];
  gated: SievePosting[];
  waiting: SievePosting[];
  scored: SievePosting[];
  /** Scored and still open to a decision (new or shortlisted), best first. */
  open: SievePosting[];
  top5: SievePosting[];
  /** Gate keys, most-catching first — the order the sieve stacks its layers. */
  gateKeys: KoReasonKey[];
  gateCounts: Partial<Record<KoReasonKey, number>>;
  decided: number;
  byDecision: { shortlisted: number; applied: number; dismissed: number };
  strong: number;
  promising: number;
  /** 1-based rank of every scored row. */
  rank: Record<string, number>;
};

export function compareScored(a: SievePosting, b: SievePosting): number {
  const ta = a.matchTotal ?? -1;
  const tb = b.matchTotal ?? -1;
  if (tb !== ta) return tb - ta;
  const wa = a.confidence ? a.confidence.high - a.confidence.low : 100;
  const wb = b.confidence ? b.confidence.high - b.confidence.low : 100;
  if (wa !== wb) return wa - wb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function isOpenStatus(status: PostingStatus): boolean {
  return status === "new" || status === "shortlisted";
}

export function deriveSieve(rows: readonly SievePosting[], sources: readonly Pick<JobseekerSource, "id" | "enabled" | "pausedReason">[]): SieveFacts {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const held: SievePosting[] = [];
  const gated: SievePosting[] = [];
  const waiting: SievePosting[] = [];
  const scored: SievePosting[] = [];
  for (const row of rows) {
    if (!sourceIsOn(byId.get(row.sourceId))) held.push(row);
    else if (row.matchTotal !== null) scored.push(row);
    else if (row.blockedBy.length > 0) gated.push(row);
    else waiting.push(row);
  }
  scored.sort(compareScored);
  const gateCounts: Partial<Record<KoReasonKey, number>> = {};
  for (const row of gated) for (const key of row.blockedBy) gateCounts[key] = (gateCounts[key] ?? 0) + 1;
  const gateKeys = (Object.keys(gateCounts) as KoReasonKey[]).sort((a, b) => (gateCounts[b] ?? 0) - (gateCounts[a] ?? 0) || (a < b ? -1 : 1));
  const open = scored.filter((r) => isOpenStatus(r.status));
  const byDecision = { shortlisted: 0, applied: 0, dismissed: 0 };
  const heldIds = new Set(held.map((r) => r.id));
  for (const row of rows) {
    if (heldIds.has(row.id)) continue;
    if (row.status === "shortlisted" || row.status === "applied" || row.status === "dismissed") byDecision[row.status]++;
  }
  const rank: Record<string, number> = {};
  scored.forEach((r, i) => {
    rank[r.id] = i + 1;
  });
  return {
    all: [...rows],
    held,
    gated,
    waiting,
    scored,
    open,
    top5: open.slice(0, 5),
    gateKeys,
    gateCounts,
    decided: byDecision.shortlisted + byDecision.applied + byDecision.dismissed,
    byDecision,
    strong: open.filter((r) => r.fitTier === "strong").length,
    promising: open.filter((r) => r.fitTier === "promising").length,
    rank,
  };
}

/** The layer a gated row is DRAWN on: the first of the sieve's gates it fails. A row
 *  failing two gates is drawn once (ringed) and ghosted on the second. */
export function firstGate(row: Pick<SievePosting, "blockedBy">, gateKeys: readonly KoReasonKey[]): KoReasonKey | null {
  for (const key of gateKeys) if (row.blockedBy.includes(key)) return key;
  return row.blockedBy[0] ?? null;
}

/** The skills missing most often across the seeker's best open postings — what would
 *  lift the most scores at once. Counted over the top `pool`. */
export function liftSkills(open: readonly SievePosting[], pool = 20, limit = 5): { pool: number; list: { skill: string; count: number }[] } {
  const counts = new Map<string, number>();
  const considered = open.slice(0, pool);
  for (const row of considered) for (const skill of row.missingSkills) counts.set(skill, (counts.get(skill) ?? 0) + 1);
  const list = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([skill, count]) => ({ skill, count }));
  return { pool: considered.length, list };
}

export type ListSort = "score" | "new" | "narrow";
export type ListFilter = {
  q: string;
  tiers: FitTier[];
  modes: WorkMode[];
  status: PostingStatus | "";
  sort: ListSort;
  /** Inclusive rank range picked on the skyline, 0-based over `scored`. */
  brush: [number, number] | null;
};

export const EMPTY_FILTER: ListFilter = { q: "", tiers: [], modes: [], status: "", sort: "score", brush: null };

export function isFilterActive(f: ListFilter): boolean {
  return f.q.trim() !== "" || f.tiers.length > 0 || f.modes.length > 0 || f.status !== "" || f.brush !== null;
}

export function filterScored(scored: readonly SievePosting[], f: ListFilter): SievePosting[] {
  const q = f.q.trim().toLowerCase();
  const out = scored.filter((row, i) => {
    if (f.brush && (i < f.brush[0] || i > f.brush[1])) return false;
    if (f.tiers.length && (!row.fitTier || !f.tiers.includes(row.fitTier))) return false;
    if (f.modes.length && (!row.workMode || !f.modes.includes(row.workMode))) return false;
    if (f.status && row.status !== f.status) return false;
    if (q) {
      const hay = [row.title, row.company ?? "", row.location ?? "", ...row.matchedSkills.map((s) => s.skill), ...row.missingSkills].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (f.sort === "new") out.sort((a, b) => (b.postedAt ?? b.firstSeenAt).localeCompare(a.postedAt ?? a.firstSeenAt) || compareScored(a, b));
  else if (f.sort === "narrow") out.sort((a, b) => bandWidth(a) - bandWidth(b) || compareScored(a, b));
  return out;
}

function bandWidth(row: SievePosting): number {
  return row.confidence ? row.confidence.high - row.confidence.low : 100;
}

/** Where a skill claim comes from, as the mark the flow draws for it. The provenance
 *  vocabulary is the profile's (`professional`, `personal_project`, `coursework`,
 *  `academic_project`, `thesis`, `self_declared`); anything else — or nothing — is drawn
 *  as a stated claim, because a claim nobody backed must never look backed. */
export type ProvenanceKey = "work" | "project" | "study" | "stated";
export type ProvenanceMark = "solid" | "half" | "ring" | "dashed";

export function provenanceOf(provenance: string | null | undefined): { key: ProvenanceKey; mark: ProvenanceMark; rank: number; stated: boolean } {
  // Every value of the taxonomy's PROVENANCE vocabulary maps here (sieveModel.test.ts
  // loops over it): only `self_declared` — or a value nobody declared — reads as stated.
  switch (provenance) {
    case "professional":
    case "internship":
      return { key: "work", mark: "solid", rank: 4, stated: false };
    case "personal_project":
    case "open_source":
      return { key: "project", mark: "half", rank: 3, stated: false };
    case "academic_project":
    case "thesis":
    case "coursework":
    case "certification":
    case "extracurricular":
      return { key: "study", mark: "ring", rank: 2, stated: false };
    default:
      return { key: "stated", mark: "dashed", rank: 1, stated: true };
  }
}

const LEVELS: Record<string, number> = { foundational: 1, working: 2, strong: 3, expert: 4 };
export function levelOf(level: string | null | undefined): number {
  return (level && LEVELS[level]) || 1;
}

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") : "?";
}
