import { listAnalysisRecords, listProfileRecords } from "./db";

// Shared candidate-pool builder (v2 profiles + saved CV analyses) — the input
// the recruiter_cli ranker scores against a job. Used by both /rediscover and
// /api/jobs/[id]/candidates so the two views rank the same population.

export type CandidatePoolEntry =
  | { id: string; label: string; profile: unknown }
  | { id: string; label: string; candidate: Record<string, unknown> };

// Pool caps: v2 profiles and saved CV analyses are bounded so the recruiter_cli
// ranker (and rediscovery) stay fast on a large corpus. A population above
// PROFILE_POOL_CAP + ANALYSIS_POOL_CAP (~160) means the overflow is never scored
// or rediscovered — so when a cap is actually hit we log it rather than dropping
// people silently. Bump these (or page) if the real corpus routinely exceeds them.
export const PROFILE_POOL_CAP = 100;
export const ANALYSIS_POOL_CAP = 60;

export function buildCandidatePool(): CandidatePoolEntry[] {
  const entries: CandidatePoolEntry[] = [];

  const profiles = listProfileRecords(PROFILE_POOL_CAP);
  if (profiles.length >= PROFILE_POOL_CAP) {
    console.warn(`[candidate-pool] profile pool hit its ${PROFILE_POOL_CAP} cap — older profiles are excluded from ranking/rediscovery.`);
  }
  for (const { row, payload } of profiles) {
    entries.push({ id: row.id, label: row.label, profile: payload });
  }

  const analyses = listAnalysisRecords(ANALYSIS_POOL_CAP);
  if (analyses.length >= ANALYSIS_POOL_CAP) {
    console.warn(`[candidate-pool] analysis pool hit its ${ANALYSIS_POOL_CAP} cap — older CV analyses are excluded from ranking/rediscovery.`);
  }
  for (const { row, payload } of analyses) {
    const p = payload as {
      candidate?: Record<string, unknown>;
      v2Profile?: Record<string, unknown>;
    };
    if (p.v2Profile && Object.keys(p.v2Profile).length > 0) {
      entries.push({ id: row.slug, label: row.candidate_label, profile: p.v2Profile });
      continue;
    }
    const c = p.candidate ?? {};
    entries.push({
      id: row.slug,
      label: row.candidate_label,
      candidate: {
        skills: (c.skills as string[]) ?? [],
        seniority: (c.currentSeniority as string) ?? "medior",
        roleFamily: (c.roleFamily as string) ?? "software_engineering",
        educationLevel: (c.educationLevel as string) ?? "unknown",
        languages: (c.languages as string[]) ?? [],
        yearsExperience: (c.yearsExperience as number) ?? 0,
        archetype: "bau",
      },
    });
  }

  return entries;
}
