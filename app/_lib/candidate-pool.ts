import { getProfileRecord, listAnalysisRecords, listProfileRecords, loadAnalysis } from "./db";

// Shared candidate-pool builder (v2 profiles + saved CV analyses) — the input
// the recruiter_cli ranker scores against a job. Used by /rediscover,
// /api/jobs/[id]/candidates, and the Decisions group evaluation so every view
// ranks the same population the same way.

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

// Derive a recruiter-pool entry from a saved CV analysis payload: prefer the v2
// profile when the analysis carries one, else fall back to the legacy flat
// candidate shape with safe defaults. Single-sourced here so the batch builder,
// the single-id resolver below, AND the group-eval's shared-resolution path
// (group-eval-run.ts, idea-c7c2d014) never diverge.
export function poolEntryFromAnalysis(id: string, label: string, payload: unknown): CandidatePoolEntry {
  const p = payload as { candidate?: Record<string, unknown>; v2Profile?: Record<string, unknown> } | null;
  if (p?.v2Profile && Object.keys(p.v2Profile).length > 0) {
    return { id, label, profile: p.v2Profile };
  }
  const c = p?.candidate ?? {};
  return {
    id,
    label,
    candidate: {
      skills: (c.skills as string[]) ?? [],
      seniority: (c.currentSeniority as string) ?? "medior",
      roleFamily: (c.roleFamily as string) ?? "software_engineering",
      educationLevel: (c.educationLevel as string) ?? "unknown",
      languages: (c.languages as string[]) ?? [],
      yearsExperience: (c.yearsExperience as number) ?? 0,
      archetype: "bau",
    },
  };
}

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
    entries.push(poolEntryFromAnalysis(row.slug, row.candidate_label, payload));
  }

  return entries;
}

// Resolve ONE candidate id to a recruiter-pool entry (a v2 profile first, else a
// saved CV analysis by slug). Lets the Decisions group evaluation score just a
// role's pending candidates against the role's job, without rebuilding the whole
// corpus pool. Returns null when the id matches neither — e.g. an inline /
// transient candidate that was never persisted — so callers can skip it.
export function resolveCandidatePoolEntry(candidateId: string, label?: string): CandidatePoolEntry | null {
  const profile = getProfileRecord(candidateId);
  if (profile) return { id: candidateId, label: label ?? profile.row.label, profile: profile.payload };
  const analysis = loadAnalysis(candidateId);
  if (analysis) return poolEntryFromAnalysis(candidateId, label ?? analysis.row.candidate_label, analysis.payload);
  return null;
}
