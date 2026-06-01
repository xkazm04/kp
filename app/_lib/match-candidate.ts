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
  // Early-career / career-switcher signals the reasoning prompt consumes
  // (match_reasoning.reasoning_context / build_prompt). They MUST ride the cache
  // key (candidateSignature) or two switchers differing only in these collide
  // and the first verdict is served to the second.
  aspirations?: string[];
  learningSignals?: string[];
  transferableSkills?: string[];
  potentialScore?: number | null;
  skillProvenance?: Record<string, string>;
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
    const payload = loaded.payload as { candidate?: Record<string, unknown>; v2Profile?: { archetype?: string } };
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
        // Real archetype from the v2 profile (not silently 'bau') so a
        // student/switcher gets the right weights + entry-eligible KO lens.
        archetype: payload?.v2Profile?.archetype ?? "bau",
        label: loaded.row.candidate_label ?? (c.name as string) ?? "Candidate",
      },
    };
  }
  if (body.candidate) return { candidate: body.candidate };
  return { error: "Provide an analysisSlug or an inline candidate.", status: 400 };
}

/** Stable signature for cache keys — independent of field order. Must cover
 *  EVERY field the reasoning prompt consumes, or two candidates differing only
 *  in an uncovered field collide on the hash and the first verdict is served to
 *  the second. */
export function candidateSignature(c: CandidateInput): string {
  return JSON.stringify({
    skills: [...(c.skills ?? [])].sort(),
    seniority: c.seniority ?? "",
    roleFamily: c.roleFamily ?? "",
    educationLevel: c.educationLevel ?? "",
    languages: [...(c.languages ?? [])].sort(),
    // yearsExperience and traits feed the reasoning prompt, so they must be in
    // the cache key — otherwise candidates differing only in years or
    // soft-signal traits collide and the first verdict is served to the second.
    yearsExperience: c.yearsExperience ?? 0,
    traits: [...(c.traits ?? [])].sort(),
    archetype: c.archetype ?? "bau",
    // Early-career / career-switcher prompt inputs — same collision hazard, and
    // these are exactly the carefully-handled candidates a wrong verdict hurts most.
    aspirations: [...(c.aspirations ?? [])].sort(),
    learningSignals: [...(c.learningSignals ?? [])].sort(),
    transferableSkills: [...(c.transferableSkills ?? [])].sort(),
    potentialScore: c.potentialScore ?? null,
    // Object key order is not guaranteed, so sort entries for a stable hash.
    skillProvenance: Object.entries(c.skillProvenance ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  });
}
