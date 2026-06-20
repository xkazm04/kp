import type { MatchResultView } from "@/app/features/sub_match/MatchTypes";

// Structured, bold-formatted head-to-head narrative (group_compare_cli). Bold
// spans are marked with **double asterisks** for RichText to render as <strong>.
export type Comparison = { headline: string; keyPoints: string[]; recommendation?: string };

// Cross-scheme fairness matrix (recruiter.fairness_check, via group-eval-run):
// each candidate carries a bounded dynamic weight vector and is re-scored under
// EVERY candidate's scheme, so a pool weighted differently per candidate ranks
// honestly (by the mean). labels / candidateIds / schemes / own / mean align by
// index; weightNotes is keyed by candidateId.
export type FairnessScheme = { skills: number; career: number; personal: number };
export type Fairness = {
  labels: string[];
  candidateIds: string[];
  schemes: FairnessScheme[];
  matrix: number[][];
  own: number[];
  mean: number[];
  ranking: string[];
  weightNotes: Record<string, string[]>;
  // "llm" when the weights were proposed by the AI (within bounds), else "deterministic".
  weightSource?: string;
};

// One candidate as carried by a group evaluation. The base fields (score,
// verdict, strengths, gaps) are always present; the recruiter breakdown fields
// are the shared MatchResultView (single-sourced from MatchTypes), all optional
// here since they're added only when the role has a job and the recruiter ranker
// ran (group-eval-run) — `total` is omitted because it is carried as `score`.
export type EvalCandidate = {
  // Stable pipeline-entry id (present on evals produced after this fix). Inline
  // advance/reject and the per-session `decided` map key on it, not the display label,
  // which isn't unique. Optional so older saved payloads still render (they fall back to
  // label via candIdentity).
  entryId?: string;
  label: string;
  score: number;
  seniority: string | null;
  archetype?: string | null;
  verdict: string;
  strengths: string[];
  gaps: string[];
  interviewProbes?: string[];
  potentialScore?: number | null;
  // SCOR3 — the why behind potentialScore. Absent on evals persisted before
  // the fields existed (the pill then renders plain, unexpandable).
  learningSignals?: string[] | null;
  transferableSkills?: string[] | null;
  domainDistance?: string | null;
  koPassed?: boolean;
  assumptions?: string[];
  // The candidate's own salary expectation (from their CV analysis). Absent for
  // profile-only candidates; the salary row then shows just the role band.
  salaryExpectation?: { minimum: number; maximum: number; midpoint: number; currency: string; confidence: string } | null;
} & Partial<Omit<MatchResultView, "total">>;

// Stable identity for an eval candidate: the pipeline entry id when present, else the
// (non-unique) display label for backward-compat with evals saved before entryId existed.
// All decide/selection keying routes through this so a duplicate display name can't apply
// an irreversible decision to the wrong person.
export const candIdentity = (c: EvalCandidate): string => c.entryId ?? c.label;

export type GroupEvalPayload = {
  roleTitle?: string;
  source?: string;
  // Governance (P1-3): "committee" / "eligibility_list" make the AI advisory (no
  // auto-sealed lead). `governanceNote` is the human guidance; `advisory` flags that
  // the topPick is a suggestion, not a decision; `eligibilityList` is the ordinal
  // ranked list (eligibility_list mode). Absent on evals saved before P1-3 (→
  // default "recommendation" behaviour at the render site).
  governanceMode?: "recommendation" | "committee" | "eligibility_list";
  governanceNote?: string | null;
  advisory?: boolean;
  eligibilityList?: { rank: number; entryId: string; label: string; score: number }[] | null;
  topPick?: { label: string; score: number; why: string } | null;
  recommendedOrder?: string[];
  candidates?: EvalCandidate[];
  differentiators?: string[];
  risks?: string[];
  summary?: string;
  // Structured AI head-to-head narrative (the modal prefers it).
  comparison?: Comparison | null;
  comparisonSource?: string | null;
  // Canonical role requirements (must-have first) for the skills rows.
  requirements?: { skill: string; kind: string }[];
  // The role's recommended salary band [min, max] — the reference the salary
  // row plots each candidate's expectation against. Empty for a job-less role.
  roleSalaryBand?: number[];
  // Cross-scheme fairness matrix. Null for a job-less role or if the ranker failed.
  fairness?: Fairness | null;
  // Coverage bookkeeping (group-eval-run): the top `cap` of `totalCandidates`
  // were compared, sorted by fit. `evaluatedLabels` is the pre-cap pool used to
  // detect drift against the role's current pending entries.
  totalCandidates?: number;
  cap?: number;
  capped?: boolean;
  evaluatedLabels?: string[];
};
