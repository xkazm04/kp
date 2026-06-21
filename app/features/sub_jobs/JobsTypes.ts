// Literal unions mirror the Python source of truth (jobs.py KINDS/HARDNESS) so an
// off-taxonomy value is a compile-time error here, not a silent miscategorisation.
export type RequirementKind = "must_have" | "nice_to_have";
export type RequirementHardness = "prerequisite" | "learnable";
export type JobRequirement = { skill: string; termId?: string | null; kind: RequirementKind; hardness: RequirementHardness };

// Single source of truth for the must/nice partition. It previously lived in two
// places with OPPOSITE fallbacks — jobMarkdown split on `kind === "must_have"` (so
// anything else fell to nice) while publish split on `kind !== "nice_to_have"` (so
// anything else fell to must) — meaning any future or off-taxonomy `kind` landed in
// different buckets in the published posting vs. the sourcing must-haves. Canonical
// rule: a skill is a must-have ONLY when kind === "must_have"; everything else
// (including any off-taxonomy value) is a nice-to-have, so a malformed kind can
// never be silently promoted into a hard sourcing filter. Returns skill strings —
// the shape both call sites consume. Tolerant of loosely-typed runtime data.
export function splitRequirements(
  reqs: readonly { skill: string; kind?: string | null }[] | null | undefined
): { mustHaves: string[]; niceToHaves: string[] } {
  const mustHaves: string[] = [];
  const niceToHaves: string[] = [];
  for (const r of reqs ?? []) {
    (r.kind === "must_have" ? mustHaves : niceToHaves).push(r.skill);
  }
  return { mustHaves, niceToHaves };
}
export type JobEntryProfile = {
  isEntryEligible: boolean;
  graduateFriendliness: number;
  reinterpretedMusts: string[];
  trainableGaps: string[];
  rationale?: string;
};
export type Job = {
  id: string;
  title: string;
  company?: string;
  location?: string;
  workMode?: string;
  employmentType?: string | null;
  seniority?: string;
  roleFamily?: string;
  languages?: string[];
  minYearsExperience?: number | null;
  minEducation?: string | null;
  description?: string;
  requirements?: JobRequirement[];
  detectedSkills?: string[];
  salaryBand?: number[];
  entryProfile?: JobEntryProfile | null;
  // Provenance from normalize_job (jobs.py DEFAULT_POLICY): field names that were
  // filled with a locale/market default because the source omitted/mis-stated them.
  // Empty/absent => every field was stated by the ad. Lets a phantom "Praha"/"medior"
  // be told from a stated one. Older payloads predate the field, hence optional.
  defaultedFields?: string[];
  // Lifecycle, decorated server-side from the jobs.status column (db.ts listJobs/
  // getJob). NULL/'published' = open for applications; a 'draft' was never live and
  // a 'closed' role's apply links serve 410 — the catalog and posting modal badge
  // both, and the modal gates its link buttons on it.
  status?: "draft" | "published" | "closed" | null;
};
// A candidate the recruiter ranker (recruiter_cli) couldn't score because its
// profile failed CandidateProfileV2/MatchCandidate validation. Surfaced — never
// dropped — so a malformed CV is explained rather than silently missing from the
// results, on both the candidates and rediscovery surfaces.
export type SkippedCandidate = { id: string; label: string; reason: string };

// e1e4e0ea — the cross-scheme fairness matrix from recruiter.fairness_check: each
// candidate scored under EVERY candidate's bounded weight scheme and ranked by the
// robust MEAN, not their own-weight score (so a candidate strong under all
// yardsticks beats one merely flattered by their own). Index-aligned across
// labels / candidateIds / own / mean; matrix[i][j] = candidate i under candidate
// j's scheme. Always present (deterministic propose_weights) when ≥1 candidate.
export type FairnessMatrix = {
  labels: string[];
  candidateIds?: string[];
  matrix: number[][];
  own: number[];
  mean: number[];
  ranking?: string[];
  weightSource?: string;
};

export type Stats = {
  total: number;
  entryEligible: number;
  byRoleFamily: Record<string, number>;
  bySeniority: Record<string, number>;
  byWorkMode: Record<string, number>;
};

export type ConfidenceLevel = "tight" | "moderate" | "wide";
/** Score band + the human reasons behind its width (matching.py `Confidence`). */
export type Confidence = {
  low: number;
  high: number;
  level: ConfidenceLevel;
  drivers: string[];
};

export type CandResult = {
  total: number;
  fitTier?: "strong" | "promising" | "partial";
  tone?: string;
  confidence: Confidence;
  matchedSkills?: string[];
  matchedSkillProvenance?: Record<string, string>;
  matchedSkillStrength?: Record<string, number>;
  missingSkills?: string[];
};
export type CandRow = {
  candidateId: string;
  label: string;
  archetype: string;
  seniority: string;
  potentialScore?: number | null;
  // SCOR3 — the why behind potentialScore (recruiter.py rows): learning
  // signals, professional-grade transferable credits, switch-bridge grade.
  learningSignals?: string[] | null;
  transferableSkills?: string[] | null;
  domainDistance?: string | null;
  koPassed: boolean;
  koReasons: string[];
  assumptions: string[];
  result: CandResult;
  // W8-5 (JOB2) — persisted sourcing state, decorated server-side: the stage
  // of this candidate's active entry for THIS job (null = not filed), and
  // whether a first-touch outreach was ever sent (the durable outreach_sent
  // event). The in-session hooks layer optimistic state on top.
  inPipeline?: string | null;
  outreachSent?: boolean;
};

// Role-family slugs come from the single canonical module (labels via enums.family).
export { ROLE_FAMILY_SLUGS as FAMILIES } from "@/app/_lib/role-families";
export const SENIORITIES = ["junior", "medior", "senior", "lead"];
export const MODES = ["remote", "hybrid", "onsite"];

// Archetype taxonomy + the early-career fairness predicate live in one canonical
// module (app/_lib/archetypes) so the protected set is never hand-copied.
export { ARCHETYPE_BADGE, isEarlyCareer } from "@/app/_lib/archetypes";

export function provLabel(p: string): { text: string; tone: string } {
  if (p === "professional") return { text: "prod", tone: "bg-stone-200 text-ink" };
  if (p === "internship") return { text: "intern", tone: "bg-blue-50 text-blue-700" };
  if (p === "self_declared") return { text: "self", tone: "bg-stone-100 text-steel" };
  if (p === "open_source") return { text: "OSS", tone: "bg-blue-50 text-blue-700" };
  if (p === "certification") return { text: "cert", tone: "bg-blue-50 text-blue-700" };
  return { text: "academic", tone: "bg-amber-50 text-amber-800" }; // thesis/project/coursework
}

export function formatBand(band?: number[]): string {
  if (!band || band.length < 2) return "—";
  return `${Math.round(band[0] / 1000)}–${Math.round(band[1] / 1000)}k`;
}
