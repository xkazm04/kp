import { listAnalysisRecords, listProfileRecords } from "./db";

// Shared candidate-pool builder (v2 profiles + saved CV analyses) — the input
// the recruiter_cli ranker scores against a job. Used by both /rediscover and
// /api/jobs/[id]/candidates so the two views rank the same population.

export type CandidatePoolEntry =
  | { id: string; label: string; profile: unknown }
  | { id: string; label: string; candidate: Record<string, unknown> };

export function buildCandidatePool(): CandidatePoolEntry[] {
  const entries: CandidatePoolEntry[] = [];

  for (const { row, payload } of listProfileRecords(100)) {
    entries.push({ id: row.id, label: row.label, profile: payload });
  }

  for (const { row, payload } of listAnalysisRecords(60)) {
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
