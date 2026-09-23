// The Profile tab's candidate population, keyed on CV IDENTITY.
//
// Two stores hold candidates: saved profiles (`profiles`) and saved CV analyses
// (`analyses`). The matrix used to show their raw union — one row per store row — so a
// CV analysed against four JDs and promoted to a profile was five chips, lane counts
// and the distribution bar counted rows instead of people, and the analysis chips kept
// offering to build a profile for a CV that already had one.
//
// The identity both stores carry is content-addressed: `analyses.cv_hash` is the
// SHA-256 of the CV bytes, and a profile built from an analysis stamps the same hash as
// `profiles.source_cv_hash` (resolved server-side, never taken from the client).
// Rows sharing a NON-NULL hash are one candidate. Nothing else is an identity key:
//
//   - a NULL hash never merges (an analysis saved before cv_hash existed, or a
//     hand-built profile, stays its own row — honest per-row, never guessed);
//   - a candidate LABEL is never compared. Labels are filename-derived ("CV.pdf") or
//     typed, two different people share them, and folding on them would silently fuse
//     two candidates — the failure hasLabelCollision exists to warn about.
//
// Merge rules, per identity:
//   - a profile wins routing: its archetype was reviewed (or at least re-routed by
//     profile_cli over the edited intake); an analysis archetype is the machine's first
//     guess;
//   - the NEWEST analysis supplies the score and the slug the chip opens, and every
//     analysis of the CV is listed newest-first on the row;
//   - two profiles with one hash (created before the server refused a second one) stay
//     two rows — neither id can be dropped — and the analyses attach to the newest.
//
// Pure and React-free: the route calls it, and the chip's single action reads
// `matrixChipAction` from here too, so "never offer build when a profile exists" is
// one rule with one test.

import type { CandidateAnalysisRef, CandidateRow } from "@/app/features/shared/profileTypes";

export type PopulationProfile = {
  id: string;
  name: string;
  role: string | null;
  seniority: string | null;
  archetype: string;
  /** The CV content hash this profile was built from; NULL for a hand-built profile. */
  sourceCvHash: string | null;
  createdAt: string;
};

export type PopulationAnalysis = {
  slug: string;
  name: string;
  role: string | null;
  seniority: string | null;
  archetype: string;
  score: number | null;
  /** SHA-256 of the CV bytes; NULL on rows saved before the column existed. */
  cvHash: string | null;
  createdAt: string;
};

/** Newest first; an exact-timestamp tie breaks on slug DESC, the same deterministic
 *  tiebreak profileStaleness uses. ISO-8601 strings compare chronologically. */
function newestFirst(a: PopulationAnalysis, b: PopulationAnalysis): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.slug < b.slug ? 1 : a.slug > b.slug ? -1 : 0;
}

function ref(a: PopulationAnalysis): CandidateAnalysisRef {
  return { slug: a.slug, score: a.score, createdAt: a.createdAt };
}

/** Fold both stores into one row per candidate identity. Profiles come first (in the
 *  order given), then analysis-only candidates in the order their newest analysis
 *  appears in the input. */
export function collapsePopulation(
  profiles: readonly PopulationProfile[],
  analyses: readonly PopulationAnalysis[]
): CandidateRow[] {
  // Analyses per hash, newest first. Null-hash analyses are kept aside, one row each.
  const byHash = new Map<string, PopulationAnalysis[]>();
  const loose: PopulationAnalysis[] = [];
  for (const a of analyses) {
    if (!a.cvHash) {
      loose.push(a);
      continue;
    }
    const list = byHash.get(a.cvHash);
    if (list) list.push(a);
    else byHash.set(a.cvHash, [a]);
  }
  for (const list of byHash.values()) list.sort(newestFirst);

  // Which profile owns each hash's analyses: the newest profile carrying that hash.
  const owner = new Map<string, PopulationProfile>();
  for (const p of profiles) {
    if (!p.sourceCvHash) continue;
    const cur = owner.get(p.sourceCvHash);
    if (!cur || p.createdAt > cur.createdAt) owner.set(p.sourceCvHash, p);
  }

  const rows: CandidateRow[] = [];
  for (const p of profiles) {
    const hash = p.sourceCvHash;
    const own = hash && owner.get(hash) === p ? (byHash.get(hash) ?? []) : [];
    const newest = own[0] ?? null;
    rows.push({
      key: `profile:${p.id}`,
      source: "profile",
      id: p.id,
      slug: newest?.slug ?? null,
      name: p.name,
      role: p.role ?? newest?.role ?? null,
      seniority: p.seniority ?? newest?.seniority ?? null,
      // A profile has no match score of its own; the newest analysis of its CV does.
      score: newest?.score ?? null,
      archetype: p.archetype,
      analyses: own.map(ref),
    });
  }

  // Analysis-only candidates: one row per un-owned hash, plus one per null-hash row.
  // Walk the input order so the population keeps the store's recency ordering.
  const emitted = new Set<string>();
  for (const a of analyses) {
    if (!a.cvHash) continue;
    if (owner.has(a.cvHash) || emitted.has(a.cvHash)) continue;
    emitted.add(a.cvHash);
    rows.push(analysisRow(byHash.get(a.cvHash) ?? [a]));
  }
  for (const a of loose) rows.push(analysisRow([a]));
  return rows;
}

function analysisRow(group: readonly PopulationAnalysis[]): CandidateRow {
  const newest = group[0];
  return {
    key: `analysis:${newest.slug}`,
    source: "analysis",
    id: null,
    slug: newest.slug,
    name: newest.name,
    role: newest.role,
    seniority: newest.seniority,
    score: newest.score,
    archetype: newest.archetype,
    analyses: group.map(ref),
  };
}

export type MatrixChipAction = { kind: "edit"; id: string } | { kind: "build"; slug: string } | null;

/** The chip's one action. A row that carries a profile id is EDITED — never offered a
 *  build, which would try to file a second profile for the same CV (the server refuses
 *  that with PROFILE_EXISTS). Only an analysis-only row offers "build a profile". */
export function matrixChipAction(row: Pick<CandidateRow, "id" | "slug">): MatrixChipAction {
  if (row.id) return { kind: "edit", id: row.id };
  if (row.slug) return { kind: "build", slug: row.slug };
  return null;
}
