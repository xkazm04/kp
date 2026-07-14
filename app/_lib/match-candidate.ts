import { loadAnalysis } from "@/app/_lib/db";
import { DEFAULT_WORKSPACE_ID } from "@/app/_lib/db/workspaces";
import { DEFAULT_ROLE_FAMILY } from "./role-families.ts";

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
  // Career-switcher bridge grade ("adjacent" | "moderate" | "far"). The reasoning
  // prompt consumes it for switchers (match_reasoning.reasoning_context /
  // build_prompt / deterministic_reasoning: it seeds the bridge narrative and the
  // ramp-up estimate), so it MUST ride the cache key — two switchers differing only
  // in domainDistance otherwise collide and the first verdict is served to the second.
  domainDistance?: string | null;
  potentialScore?: number | null;
  skillProvenance?: Record<string, string>;
};

export type ResolvedCandidate = { candidate: CandidateInput } | { error: string; status: number };

/**
 * Build a CandidateInput from either a saved analysis slug or an inline candidate.
 * Shared by /api/match and /api/match/reasoning so the mapping stays in one place.
 */
export function resolveCandidate(
  body: {
    analysisSlug?: string;
    candidate?: CandidateInput;
  },
  // Tenancy: an analysisSlug must resolve only within the caller's workspace, so a
  // cross-workspace slug is not-found rather than leaking another tenant's candidate.
  workspaceId: string = DEFAULT_WORKSPACE_ID
): ResolvedCandidate {
  if (body.analysisSlug) {
    const loaded = loadAnalysis(body.analysisSlug, workspaceId);
    if (!loaded) return { error: "Analysis not found.", status: 404 };
    const payload = loaded.payload as { candidate?: Record<string, unknown>; v2Profile?: { archetype?: string } };
    const c = payload?.candidate ?? {};
    return {
      candidate: {
        skills: (c.skills as string[]) ?? [],
        // Fail-open, don't assume: an analysis with no captured seniority/family
        // passes explicit "unknown"/DEFAULT_ROLE_FAMILY sentinels, NOT a fabricated
        // "medior"/"software_engineering". role-families.ts::DEFAULT_ROLE_FAMILY
        // ("general_professional", "Never assume software") is the single source of
        // the neutral family so a nurse/electrician isn't matched as a mid-level SWE.
        // Python's _SENIORITY_RANK.get(..., 2) treats "unknown" as neutral for
        // scoring, and ko_filter fails closed on the "unknown" archetype below — so
        // neither sentinel triggers a hard gate on a family we couldn't detect.
        seniority: (c.currentSeniority as string) ?? "unknown",
        roleFamily: (c.roleFamily as string) ?? DEFAULT_ROLE_FAMILY,
        educationLevel: (c.educationLevel as string) ?? "unknown",
        languages: (c.languages as string[]) ?? [],
        yearsExperience: (c.yearsExperience as number) ?? 0,
        traits: (c.traits as string[]) ?? [],
        // Real archetype from the v2 profile when present. When it's missing
        // (v2Profile.archetype is best-effort and can be null), pass an explicit
        // "unknown" sentinel rather than silently collapsing to "bau" — "bau"
        // would apply the seniority KO floor and strip the fairness shield from a
        // student/switcher. The Python ko_filter fails closed on "unknown"
        // (no seniority auto-KO) and weights_for falls back to neutral BAU weights.
        archetype: payload?.v2Profile?.archetype ?? "unknown",
        // Carry a career-switcher's bridge grade through when the analysis captured
        // one, so both the reasoning prompt and its cache key see it.
        domainDistance: (c.domainDistance as string | undefined) ?? null,
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
    // Fail-closed sentinel, matching resolveCandidate's "unknown" default (af60167):
    // defaulting to "bau" here disagreed with the resolved candidate's archetype, so
    // an inline candidate with no archetype was keyed as "bau" while scored as
    // "unknown". Now both agree — see the commit body for the cache-key impact.
    archetype: c.archetype ?? "unknown",
    // Early-career / career-switcher prompt inputs — same collision hazard, and
    // these are exactly the carefully-handled candidates a wrong verdict hurts most.
    aspirations: [...(c.aspirations ?? [])].sort(),
    learningSignals: [...(c.learningSignals ?? [])].sort(),
    transferableSkills: [...(c.transferableSkills ?? [])].sort(),
    // Career-switcher bridge grade — consumed by the reasoning prompt (see the
    // CandidateInput field note), so a switcher's cached verdict must not survive a
    // change from "far" to "adjacent".
    domainDistance: c.domainDistance ?? null,
    potentialScore: c.potentialScore ?? null,
    // Object key order is not guaranteed, so sort entries for a stable hash.
    skillProvenance: Object.entries(c.skillProvenance ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  });
}
