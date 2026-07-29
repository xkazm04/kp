import type { MatchResultView } from "@/app/features/shared/matchTypes";

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

// Robustness-assessment status of the weighting-robustness ("fairness") check,
// computed server-side (group-eval-run) and carried on the payload so the panel
// renders the TRUTH and the sealed decision record states it (bug-ui-scan-2026-07-09):
//   assessed       — the ranker ran AND weights actually VARY across candidates, so the
//                    cross-scheme re-scoring genuinely tested the order.
//   not_varied     — the ranker ran but every candidate carries the same (uniform)
//                    weighting, so the cross-scheme test is a NO-OP: "order unchanged"
//                    is guaranteed a priori and proves nothing. NOT "robust".
//   unavailable    — the role has a job (a matrix was expected) but the ranker produced
//                    no fairness data (it failed / did not run): "could not assess".
//   not_applicable — a job-less role: there is no ranker, so robustness legitimately does
//                    not apply (the panel stays hidden — no false claim).
//   insufficient_sample — the field is below the min-cohort floor (a SINGLE candidate,
//                    group-eval-cohort.ts), so there is no field to re-rank: no robustness
//                    is claimed and no lead is crowned (bug-ui-scan-2026-07-09 #4).
export type RobustnessStatus = "assessed" | "not_varied" | "unavailable" | "not_applicable" | "insufficient_sample";

/** The honest robustness status of a group eval, derived from whether the role had a
 *  job (so a ranker ran) and whether that ranker produced a fairness matrix whose
 *  weights actually vary. Single-sourced so the panel copy AND the sealed decision
 *  record agree, and so a no-op / a missing check can never read as a PASS. */
export function assessRobustness(hasJob: boolean, fairness: Fairness | null): RobustnessStatus {
  if (!hasJob) return "not_applicable";
  if (!fairness || !fairness.labels?.length || !fairness.matrix?.length) return "unavailable";
  const varied = fairness.candidateIds.some((id) => (fairness.weightNotes?.[id]?.length ?? 0) > 0);
  return varied ? "assessed" : "not_varied";
}

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
  // null = unscored: the candidate has neither a fresh recruiter total nor a
  // stored match score. Rendered as a dash (ScoreBadge's null chip), never a
  // fabricated 0 (REC-03).
  score: number | null;
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
  eligibilityList?: { rank: number; entryId: string; label: string; score: number | null }[] | null;
  topPick?: { label: string; score: number | null; why: string } | null;
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
  // Robustness-assessment status of the fairness check (bug-ui-scan-2026-07-09): lets
  // the panel render "not tested" / "could not assess" honestly instead of a silently
  // absent panel or a false "robust", and mirrors what the sealed decision record now
  // states. Absent on evals saved before this field existed (→ the panel falls back to
  // the pre-existing hide-when-no-fairness behaviour).
  robustness?: RobustnessStatus;
  // Coverage bookkeeping (group-eval-run): the top `cap` of `totalCandidates`
  // were compared, sorted by fit. `evaluatedLabels` is the pre-cap pool used to
  // detect drift against the role's current pending entries.
  totalCandidates?: number;
  cap?: number;
  capped?: boolean;
  // group-eval-cohort-choice: present only when the recruiter compared an EXPLICIT
  // selection rather than the default top-N. `count` were compared out of `total` in
  // the role cohort — the modal discloses "comparing your selection of {count} of
  // {total}" instead of the capped top-N wording. Absent (null) on default top-N runs
  // and on evals saved before this field existed.
  selection?: { count: number; total: number } | null;
  evaluatedLabels?: string[];
  // selection-memory-rerun — stable entry ids alongside the display labels, so drift
  // detection and the in-modal Re-run key on IDENTITY (not the non-unique label, which
  // mishandles two same-named candidates). Both ADDITIVE: a payload saved before these
  // fields renders exactly as today (drift falls back to labels; Re-run to top-N).
  //   • evaluatedIds — the FULL role cohort at eval time (parallel to evaluatedLabels),
  //     used for id-based pool-drift.
  //   • comparedIds — the entry ids actually COMPARED (post validation/cap). For a
  //     selection-launched eval this is the recruiter's selection, replayed on Re-run.
  evaluatedIds?: string[];
  comparedIds?: string[];
};
