import { loadAnalysis } from "@/app/_lib/db";

// Shape passed to the Python matcher (camelCase; MatchCandidate accepts aliases).
export type CandidateInput = {
  skills?: string[];
  seniority?: string;
  roleFamily?: string;
  educationLevel?: string;
  languages?: string[];
  yearsExperience?: number;
  traits?: string[];
  preferredWorkModes?: string[];
  archetype?: string;
  label?: string;
};

export type ResolvedCandidate = { candidate: CandidateInput } | { error: string; status: number };

/**
 * Build a CandidateInput from either a saved analysis slug or an inline candidate.
 * Shared by /api/match and /api/match/reasoning so the mapping stays in one place.
 */
export function resolveCandidate(body: {
  analysisSlug?: string;
  candidate?: CandidateInput;
}): ResolvedCandidate {
  if (body.analysisSlug) {
    const loaded = loadAnalysis(body.analysisSlug);
    if (!loaded) return { error: "Analysis not found.", status: 404 };
    const payload = loaded.payload as { candidate?: Record<string, unknown> };
    const c = payload?.candidate ?? {};
    return {
      candidate: {
        skills: (c.skills as string[]) ?? [],
        seniority: (c.currentSeniority as string) ?? "medior",
        roleFamily: (c.roleFamily as string) ?? "software_engineering",
        educationLevel: (c.educationLevel as string) ?? "unknown",
        languages: (c.languages as string[]) ?? [],
        yearsExperience: (c.yearsExperience as number) ?? 0,
        traits: (c.traits as string[]) ?? [],
        label: loaded.row.candidate_label ?? (c.name as string) ?? "Candidate",
      },
    };
  }
  if (body.candidate) return { candidate: body.candidate };
  return { error: "Provide an analysisSlug or an inline candidate.", status: 400 };
}

/** Stable signature for cache keys — independent of field order. */
export function candidateSignature(c: CandidateInput): string {
  return JSON.stringify({
    skills: [...(c.skills ?? [])].sort(),
    seniority: c.seniority ?? "",
    roleFamily: c.roleFamily ?? "",
    educationLevel: c.educationLevel ?? "",
    languages: [...(c.languages ?? [])].sort(),
    archetype: c.archetype ?? "bau",
  });
}
