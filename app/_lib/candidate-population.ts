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
// ONE population for the whole tab (challenge-r05 profile-roster-matrix/A). The roster,
// the matrix and the archetype retire dialog used to read three different things — the
// roster GET /api/profile (saved profiles only), the matrix this fold, the dialog the
// roster list again — so they disagreed on the family, on staleness and on how many
// candidates a retired lane holds. A profile row now also carries its completeness and
// its staleness, so every projection derives from these rows: the roster via
// rosterFromPopulation (profileRosterView.ts), the retire dialog via routedCount, and
// a delete prunes them all at once via withoutProfile.
//
// Pure and React-free: the route calls it, and the chip's single action reads
// `matrixChipAction` from here too, so "never offer build when a profile exists" is
// one rule with one test.

import { normalizeArchetype } from "@/app/_lib/archetypes";
import type { CandidateAnalysisRef, CandidateRow, ProfilePayload } from "@/app/features/shared/profileTypes";

export type PopulationProfile = {
  id: string;
  name: string;
  role: string | null;
  seniority: string | null;
  archetype: string;
  /** The CV content hash this profile was built from; NULL for a hand-built profile. */
  sourceCvHash: string | null;
  createdAt: string;
  /** Intake completeness 0..1 (the roster's Completeness column); null when unknown. */
  completeness?: number | null;
};

/** A profile whose CV has a NEWER analysis than the one it was built from (the same
 *  shape profileStaleness returns — the rebuild target and its analyzed-at). */
export type PopulationStaleness = { newerSlug: string; newerAnalyzedAt: string };

/** One candidate as every projection of the Profile tab sees it. `completeness` and
 *  `stale` are a saved profile's; an analysis-only row carries null for both. */
export type PopulationRow = CandidateRow & {
  completeness: number | null;
  stale: PopulationStaleness | null;
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
  analyses: readonly PopulationAnalysis[],
  /** profile id → its staleness (profileStaleness); an absent id is current. */
  stale: Readonly<Record<string, PopulationStaleness>> = {}
): PopulationRow[] {
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

  const rows: PopulationRow[] = [];
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
      completeness: p.completeness ?? null,
      // Own-key read: the map is keyed by content-free ids, and a prototype name must
      // never read as a staleness entry.
      stale: Object.hasOwn(stale, p.id) ? stale[p.id] : null,
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

function analysisRow(group: readonly PopulationAnalysis[]): PopulationRow {
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
    completeness: null,
    stale: null,
  };
}

/** A saved profile's store record, as the population reads it. The FAMILY is resolved
 *  here, once — the denormalized column, else the payload's roleFamily — so the roster
 *  and the matrix can no longer give two answers for one person. */
export function profileFromRecord(rec: {
  row: {
    id: string;
    label: string;
    archetype: string | null;
    role_family: string | null;
    completeness: number | null;
    created_at: string;
  };
  payload: unknown;
  sourceCvHash: string | null;
}): PopulationProfile {
  const p = (rec.payload as ProfilePayload | null) ?? {};
  return {
    id: rec.row.id,
    name: rec.row.label,
    role: rec.row.role_family ?? p.roleFamily ?? null,
    seniority: p.seniority ?? null,
    // Honest fail-closed sentinel (NOT "bau") for an unrouted profile.
    archetype: rec.row.archetype ?? "unknown",
    sourceCvHash: rec.sourceCvHash,
    createdAt: rec.row.created_at,
    completeness: rec.row.completeness,
  };
}

/** A saved CV analysis's store record, as the population reads it. */
export function analysisFromRecord(rec: {
  row: {
    slug: string;
    candidate_label: string;
    role_family: string | null;
    seniority: string | null;
    score: number | null;
    cv_hash?: string | null;
    created_at: string;
  };
  payload: unknown;
}): PopulationAnalysis {
  const v2 = (rec.payload as { v2Profile?: { archetype?: string } } | null)?.v2Profile;
  return {
    slug: rec.row.slug,
    name: rec.row.candidate_label,
    role: rec.row.role_family,
    seniority: rec.row.seniority,
    score: rec.row.score,
    // Honest fail-closed sentinel (NOT "bau"): collapsing an unrouted candidate to "bau"
    // mislabels a fairness-protected class. The matrix renders "unknown" as the
    // "Unrouted" column via archetypeDisplayKey.
    archetype: v2?.archetype ?? "unknown",
    cvHash: rec.row.cv_hash ?? null,
    createdAt: rec.row.created_at,
  };
}

/** Values that mean "not routed" — never an archetype anyone can retire. */
const UNROUTED = new Set(["", "unknown", "unrouted"]);

/**
 * How many candidates route to one archetype, per store — the retire dialog's blast
 * radius. It counts BOTH stores because the matrix lane being retired shows both: a
 * count of saved profiles alone said "No profile routes here" over a lane full of
 * analysed candidates.
 *
 * Matched on the normalized archetype id, not on archetypeDisplayKey: only a
 * workspace's OWN archetypes can be retired, and the display key folds any id the
 * bundled registry does not know (a custom archetype created at runtime) into
 * "unrouted" — which would count zero for exactly the archetypes this dialog serves.
 * The unrouted sentinels never count toward anything.
 */
export function routedCount(
  rows: readonly Pick<PopulationRow, "source" | "archetype">[],
  archetypeId: string
): { profiles: number; analyses: number } {
  const target = normalizeArchetype(archetypeId);
  const out = { profiles: 0, analyses: 0 };
  if (UNROUTED.has(target)) return out;
  for (const row of rows) {
    if (normalizeArchetype(row.archetype) !== target) continue;
    if (row.source === "profile") out.profiles += 1;
    else out.analyses += 1;
  }
  return out;
}

/**
 * The population after a profile delete — the optimistic prune every projection sees
 * at once. Returns the SAME array when no row carries that id, so a delete of an
 * unknown id re-renders nothing.
 */
export function withoutProfile<R extends Pick<PopulationRow, "id">>(rows: readonly R[], id: string): readonly R[] {
  if (!rows.some((r) => r.id === id)) return rows;
  return rows.filter((r) => r.id !== id);
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
