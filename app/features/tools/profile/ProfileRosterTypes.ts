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
export type StaleMap = Record<string, { newerSlug: string; newerAnalyzedAt: string }>;
