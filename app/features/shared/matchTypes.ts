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

// A localizable label the Python engine emits as a stable CODE + render params
// rather than prose (localize-python-seam): the TS side renders the actual language
// from a next-intl catalog, keyed by `code`, interpolating `params`. Every carrier
// also keeps a parallel English string, so an older codeless payload still renders.
export type LabelCode = { code: string; params?: Record<string, string | number> };

// One row of the weight-aware score breakdown, all on a single 0-100 scale so the
// bars render with zero client-side math (server: matching.build_score_breakdown).
// percent = the dimension's own score; weight = its share of the total (the three
// sum to 100); contribution = the points it adds to `total` (the three sum to ~total).
// `label` is the archetype-aware English display name; `labelCode` is the
// locale-independent catalog slug (match.dims.*) the UI localizes, label as fallback.
export type ScoreDimension = {
  key: string;
  label: string;
  labelCode?: string;
  percent: number;
  weight: number;
  contribution: number;
};

export type ConfidenceLevel = "tight" | "moderate" | "wide";
/** Score band + the human reasons behind its width (matching.py `Confidence`).
 *  `drivers` are the legacy English strings; `driverCodes` are their parallel
 *  locale-independent codes (match.drivers.*) the UI localizes, zipping index-for-
 *  index with `drivers` as the fallback. Absent driverCodes -> render `drivers`. */
export type Confidence = {
  low: number;
  high: number;
  level: ConfidenceLevel;
  drivers: string[];
  driverCodes?: LabelCode[];
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
  // Claimed-but-UNPROVEN required skills: named (or a relative named) but scored
  // above 0 and below the match threshold — neither matched nor missing. Additive;
  // absent means none. `unprovenSkillReason` tells a near-miss specialist
  // ("adjacency") from an unsubstantiated claim ("provenance" | "both").
  unprovenSkills?: string[];
  unprovenSkillStrength?: Record<string, number>;
  unprovenSkillReason?: Record<string, string>;
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
  // The claimed-but-UNPROVEN bucket (round 7) rides the shared view so the single
  // decision surface can tell a near-miss specialist (`unprovenSkillReason` =
  // "adjacency") from an unsubstantiated claim ("provenance" | "both") — neither
  // matched nor missing. Additive & optional: an older analysis without them
  // renders exactly as before (absent = no chrome).
  | "unprovenSkills"
  | "unprovenSkillStrength"
  | "unprovenSkillReason"
>;
// One aggregated KO blocker: how many roles tripped a given hard gate, with a
// candidate-facing clause that reads after "{count} role(s)" (server-supplied so
// the wording stays a single source of truth). See matching.aggregate_ko_reasons.
export type KoReason = { key: string; label: string; count: number };

// The three score dimensions a recruiter can re-weight (MAT1). Keys match the
// Python scorer (`_DIMENSION_KEYS`); labels are archetype-aware in the UI.
export type WeightVector = { skills: number; career: number; personal: number };

export const WEIGHT_DIMS = ["skills", "career", "personal"] as const;

// bug-ui-scan-2026-07-09 (candidate-profile-job-matching #5): the two pure rules the
// WeightsPanel's slider state depends on, extracted so they're unit-tested (a .tsx
// can't be loaded by node --test).
//
// `weightsDirty` — did the recruiter move a slider off the in-effect vector? Compared
// in WHOLE percent (the sliders step in 1%), so sub-percent float jitter from the
// server's renormalization never falsely marks the panel dirty. Drives the "Apply
// re-rank" enabled state.
export function weightsDirty(draft: WeightVector, weights: WeightVector): boolean {
  return WEIGHT_DIMS.some((d) => Math.round(draft[d] * 100) !== Math.round(weights[d] * 100));
}

// `syncDraftToWeights` — the vector the panel must re-anchor its draft sliders to after
// each apply: the server-renormalized `weights` actually in effect, NEVER the recruiter's
// pre-normalization drag. Returns a FRESH object so a setState always re-renders and the
// panel never shares the prop's reference. Pre-fix the draft was never re-synced, so the
// sliders + `{n}%` labels disagreed with the ranking and the button stayed falsely enabled.
export function syncDraftToWeights(weights: WeightVector): WeightVector {
  return { skills: weights.skills, career: weights.career, personal: weights.personal };
}

export type MatchResponse = {
  candidate: {
    label?: string;
    seniority?: string;
    roleFamily?: string;
    archetype?: string;
    skills?: number;
    potentialScore?: number | null;
    // SCOR3 — the why behind potentialScore (matching.py candidate block).
    learningSignals?: string[] | null;
    transferableSkills?: string[] | null;
    domainDistance?: string | null;
    assumptions?: string[];
    // Locale-independent codes parallel to `assumptions` (match.assumptions.*); the
    // UI localizes these, zipping with `assumptions` as the fallback string.
    assumptionCodes?: LabelCode[];
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
export type ReasoningState = { loading?: boolean; error?: string; source?: string; cached?: boolean; narrativeLang?: string; data?: Reasoning };

// Archetype labels + the early-career fairness predicate live in one canonical
// module (app/_lib/archetypes) so the protected set is never hand-copied.
export { ARCHETYPE_LABEL, isEarlyCareer, archetypeDisplayKey } from "@/app/_lib/archetypes";

// The match total to write back to the pipeline snapshot when a fresh match run
// files a candidate. A fresh /api/match `m.total` (producer C in match-score.ts)
// is the freshest measurement we have, so persisting it closes the divergence with
// the never-updated snapshot — but only when it is a real, finite number. A
// non-finite/absent total is stored as null (the null-score policy in
// match-score.ts), never coerced to a decision-feeding 0.
export function matchScoreForPipeline(total: number | null | undefined): number | null {
  return typeof total === "number" && Number.isFinite(total) ? total : null;
}

// Provenance bucket key (matches the `enums.provenance.*` catalog) + its badge tone.
// The display text is resolved via `useEnumLabel("provenance", key)` at the render
// site — this is module-level so it can't call the hook itself.
export type ProvenanceKey =
  | "observed"
  | "professional"
  | "internship"
  | "self_declared"
  | "open_source"
  | "certification"
  | "academic";

export function provLabel(p: string): { key: ProvenanceKey; tone: string } {
  // `observed` is the highest-trust provenance the pipeline can mint (a passed
  // live case or case-grounded interview) — it gets the strongest visual stamp,
  // and must never fall through to the generic "academic" bucket.
  if (p === "observed") return { key: "observed", tone: "bg-moss/15 text-moss" };
  if (p === "professional") return { key: "professional", tone: "bg-stone-200 text-ink" };
  if (p === "internship") return { key: "internship", tone: "bg-blue-50 text-blue-700" };
  if (p === "self_declared") return { key: "self_declared", tone: "bg-stone-100 text-steel" };
  if (p === "open_source") return { key: "open_source", tone: "bg-blue-50 text-blue-700" };
  if (p === "certification") return { key: "certification", tone: "bg-blue-50 text-blue-700" };
  return { key: "academic", tone: "bg-amber-50 text-amber-800" };
}

/** Compact "k CZK" salary band for the match surfaces, e.g. `"45–60k CZK"`, or
 *  `"—"` when there isn't a [min, max] pair. The match cards deliberately use this
 *  abbreviated form (vs. the app-wide grouped `formatSalaryRange`), so this is the
 *  one place MatchCard and JobCompare share it instead of re-deriving the math. */
export function formatBandCompact(band?: number[]): string {
  if (!band || band.length !== 2) return "—";
  return `${Math.round(band[0] / 1000)}–${Math.round(band[1] / 1000)}k CZK`;
}
