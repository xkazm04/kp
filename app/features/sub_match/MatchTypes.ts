export type AnalysisRow = {
  slug: string;
  candidate_label: string;
  role_family: string | null;
  seniority: string | null;
};
export type ProfileRow = {
  id: string;
  label: string;
  archetype: string | null;
  role_family: string | null;
  completeness: number | null;
};

// One row of the weight-aware score breakdown, all on a single 0-100 scale so the
// bars render with zero client-side math (server: matching.build_score_breakdown).
// percent = the dimension's own score; weight = its share of the total (the three
// sum to 100); contribution = the points it adds to `total` (the three sum to ~total).
export type ScoreDimension = {
  key: string;
  label: string;
  percent: number;
  weight: number;
  contribution: number;
};

export type ConfidenceLevel = "tight" | "moderate" | "wide";
/** Score band + the human reasons behind its width (matching.py `Confidence`). */
export type Confidence = {
  low: number;
  high: number;
  level: ConfidenceLevel;
  drivers: string[];
};

export type MatchResult = {
  jobId: string;
  title: string;
  company?: string;
  location?: string;
  workMode?: string;
  seniority?: string;
  roleFamily?: string;
  salaryBand?: number[];
  total: number;
  fitTier?: "strong" | "promising" | "partial";
  skillsScore: number;
  careerScore: number;
  personalScore: number;
  scoreBreakdown?: ScoreDimension[];
  confidence: Confidence;
  matchedSkills?: string[];
  matchedSkillProvenance?: Record<string, string>;
  // Per-matched-skill strength in (0,1]: 1.0 exact, lower = taxonomy/sibling or
  // provenance-discounted partial hit (matching._MATCH_THRESHOLD).
  matchedSkillStrength?: Record<string, number>;
  missingSkills?: string[];
  isEntryEligible?: boolean;
  graduateFriendliness?: number;
};

// The per-candidate recruiter result subset shared across the decision UI — the
// group-eval run (group-eval-run.ts), the single-candidate summary
// (AnalysisSummaryModal), and the comparison modal (GroupEvalModal). A Pick view
// onto the canonical MatchResult so an added/renamed field (e.g. matchedSkillStrength)
// propagates to every consumer instead of silently drifting across hand-maintained
// copies. Mirrors MatchResult's optionality: total/confidence required, the rest optional.
export type MatchResultView = Pick<
  MatchResult,
  | "total"
  | "fitTier"
  | "confidence"
  | "scoreBreakdown"
  | "matchedSkills"
  | "matchedSkillProvenance"
  | "matchedSkillStrength"
  | "missingSkills"
>;
// One aggregated KO blocker: how many roles tripped a given hard gate, with a
// candidate-facing clause that reads after "{count} role(s)" (server-supplied so
// the wording stays a single source of truth). See matching.aggregate_ko_reasons.
export type KoReason = { key: string; label: string; count: number };

// The three score dimensions a recruiter can re-weight (MAT1). Keys match the
// Python scorer (`_DIMENSION_KEYS`); labels are archetype-aware in the UI.
export type WeightVector = { skills: number; career: number; personal: number };

export type MatchResponse = {
  candidate: {
    label?: string;
    seniority?: string;
    roleFamily?: string;
    archetype?: string;
    skills?: number;
    potentialScore?: number | null;
    assumptions?: string[];
    // MAT1: the weight vector actually used + the archetype's allowed [min,max]
    // per dimension, so the UI seeds bounded sliders at the values in effect.
    weights?: WeightVector;
    weightBounds?: Record<string, [number, number]>;
  };
  meta: {
    evaluated?: number;
    koFiltered?: number;
    survivors?: number;
    returned?: number;
    koReasons?: KoReason[];
  };
  matches: MatchResult[];
};
export type MatchRef = { profileId?: string; analysisSlug?: string };

export type Reasoning = { verdict: string; strengths: string[]; gaps: string[]; interviewProbes: string[] };
export type ReasoningState = { loading?: boolean; error?: string; source?: string; cached?: boolean; data?: Reasoning };

export const FAMILY_LABEL: Record<string, string> = {
  software_engineering: "Software",
  data_ai: "Data / AI",
  product_project: "Product / Project",
};
// Archetype labels + the early-career fairness predicate live in one canonical
// module (app/_lib/archetypes) so the protected set is never hand-copied.
export { ARCHETYPE_LABEL, isEarlyCareer } from "@/app/_lib/archetypes";

export function provLabel(p: string): { text: string; tone: string } {
  // `observed` is the highest-trust provenance the pipeline can mint (a passed
  // live case or case-grounded interview) — it gets the strongest visual stamp,
  // and must never fall through to the generic "academic" bucket.
  if (p === "observed") return { text: "observed", tone: "bg-moss/15 text-moss" };
  if (p === "professional") return { text: "prod", tone: "bg-stone-200 text-ink" };
  if (p === "internship") return { text: "intern", tone: "bg-blue-50 text-blue-700" };
  if (p === "self_declared") return { text: "self", tone: "bg-stone-100 text-steel" };
  if (p === "open_source") return { text: "OSS", tone: "bg-blue-50 text-blue-700" };
  if (p === "certification") return { text: "cert", tone: "bg-blue-50 text-blue-700" };
  return { text: "academic", tone: "bg-amber-50 text-amber-800" };
}
