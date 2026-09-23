// Row/stale shapes shared between ProfileRoster.tsx and ProfileRosterRow.tsx.

// A saved v2 intake profile, as GET /api/profile lists it (ProfileRow, denormalized
// columns off the profiles table).
export type RosterProfile = {
  id: string;
  label: string;
  archetype: string | null;
  role_family: string | null;
  completeness: number | null;
};

// profile id → the newer same-CV analysis that makes it stale (GET /api/profile
// `stale`). Present ONLY for profiles with source lineage AND a newer analysis;
// a hand-built profile never appears here (no badge, no chrome).
//
// `edited` / `updatedAt` ride along from profileStaleness (the population route passes
// its entries through): whether the profile carries a recruiter's edits since its
// build, and the version a refresh re-asserts. Optional because the population row's
// declared type predates them — an entry that lacks either is treated as NOT provably
// unedited, so the batch refresh routes it to review instead of writing it.
export type StaleEntry = { newerSlug: string; newerAnalyzedAt: string; edited?: boolean; updatedAt?: string | null };
export type StaleMap = Record<string, StaleEntry>;
