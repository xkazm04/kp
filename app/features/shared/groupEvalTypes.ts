import type { MatchResultView } from "@/app/features/shared/matchTypes";
import { GROUP_EVAL_MIN_COHORT } from "@/app/_lib/group-eval-cohort";

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
  // Robust order as candidate ids (KO excluded); `ranking` is its label twin. Labels
  // are not unique. Absent on legacy blobs (readers fall back to labels).
  rankingIds?: string[];
  koFailed?: string[];
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

/** Is a fairness blob actually renderable — i.e. do the parallel arrays the panel
 *  indexes in lockstep (labels / candidateIds / schemes / own / mean / ranking, and
 *  the matrix's row AND column counts) really agree in length?
 *
 *  The type above ASSERTS that alignment; nothing enforced it. The payload is
 *  persisted as JSON (group-eval.ts) and re-parsed unvalidated on every open, so one
 *  malformed blob — a Python-side shape change, a truncated write, a hand-edited row —
 *  used to throw inside the panel's unguarded `schemes[j].skills` / `matrix[i][j]` /
 *  `mean[i]` indexing and take the WHOLE modal down: comparison table, decide buttons
 *  and the Re-run button that would have replaced the bad blob included. Returning
 *  false here degrades that to the honest "could not assess" panel instead.
 *
 *  `own` is lockstep with labels (the matrix diagonal). `ranking` is the robust
 *  order over that same field; a truncated ranking used to pass this guard and
 *  then report agreement with a headline that was never fully compared. The
 *  ranker drops KO-failed candidates from ranking (`recruiter.fairness_check`);
 *  those rows stay in the matrix and are counted via optional `koFailed`. */
export function isFairnessAligned(fairness: Fairness | null | undefined): fairness is Fairness {
  if (!fairness) return false;
  const { labels, candidateIds, schemes, matrix, mean, ranking, weightNotes, own } = fairness;
  if (!Array.isArray(labels) || labels.length === 0) return false;
  const n = labels.length;
  const sameLength = (a: unknown) => Array.isArray(a) && a.length === n;
  if (!sameLength(candidateIds) || !sameLength(schemes) || !sameLength(mean) || !sameLength(matrix) || !sameLength(own)) return false;
  // Every row must span every column — the matrix is square by contract (each
  // candidate re-scored under every candidate's scheme).
  if (!matrix.every((row) => Array.isArray(row) && row.length === n)) return false;
  // The scheme cells the header formats, and the two collections the notes list walks.
  if (!schemes.every((s) => s != null && typeof s.skills === "number" && typeof s.career === "number" && typeof s.personal === "number")) return false;
  if (!Array.isArray(ranking)) return false;
  const koFailed: unknown = fairness.koFailed;
  const koCount = Array.isArray(koFailed) ? koFailed.length : 0;
  if (ranking.length + koCount !== n) return false;
  const labelSet = new Set(labels);
  if (!ranking.every((l) => typeof l === "string" && labelSet.has(l))) return false;
  // rankingIds (when present) is checked as identity: known, unique, not KO'd, and
  // `ranking` its label twin. Legacy blobs get the label rule above alone.
  const rankingIds: unknown = fairness.rankingIds;
  if (rankingIds !== undefined) {
    if (!Array.isArray(rankingIds) || rankingIds.length !== ranking.length) return false;
    const indexOf = new Map(candidateIds.map((id, i) => [id, i] as const));
    const koSet = new Set(Array.isArray(koFailed) ? koFailed : []);
    const seen = new Set<string>();
    for (const [i, id] of rankingIds.entries()) {
      if (typeof id !== "string" || !indexOf.has(id) || seen.has(id) || koSet.has(id)) return false;
      if (labels[indexOf.get(id)!] !== ranking[i]) return false;
      seen.add(id);
    }
  }
  if (weightNotes != null && typeof weightNotes !== "object") return false;
  return true;
}

/** The honest robustness status of a group eval, derived from whether the role had a
 *  job (so a ranker ran) and whether that ranker produced a fairness matrix whose
 *  weights actually vary. Single-sourced so the panel copy AND the sealed decision
 *  record agree, and so a no-op / a missing check can never read as a PASS. A
 *  MISALIGNED matrix is treated exactly like a missing one — an unreadable check is
 *  not a check. An aligned field below `GROUP_EVAL_MIN_COHORT` is
 *  `insufficient_sample` (no field to re-rank, no lead to crown). */
export function assessRobustness(hasJob: boolean, fairness: Fairness | null): RobustnessStatus {
  if (!hasJob) return "not_applicable";
  if (!isFairnessAligned(fairness)) return "unavailable";
  if (fairness.labels.length < GROUP_EVAL_MIN_COHORT) return "insufficient_sample";
  const first = fairness.schemes[0];
  const varied = fairness.schemes.some((scheme) =>
    scheme.skills !== first.skills || scheme.career !== first.career || scheme.personal !== first.personal
  );
  return varied ? "assessed" : "not_varied";
}

// ---- Structured facts (eval-speaks-your-language) --------------------------
//
// The eval is PERSISTED once and re-rendered for whoever opens it, so any prose
// baked into the payload is frozen in the language of the machine that produced
// it. The AI compare narrative is generated in the org locale (group-eval-run →
// group_compare_cli --lang), but the deterministic prose around it used to be
// English literals appended to the payload — so a Czech workspace read a Czech
// headline stacked on English risks and an English (compliance-critical)
// governance banner in the same modal.
//
// The fix is the same shape the rest of the app uses for server-generated
// display data (cf. useEnumLabel: the WIRE value stays canonical, only the
// rendered label is localized): the server persists STRUCTURED FACTS and the
// client composes the sentence through next-intl at render time. See
// ./localize.ts for the composition and the legacy-prose fallback.

/** One pool-level watch-out as facts. Legacy payloads carry the English sentence
 *  as a bare string instead — both shapes are accepted by `risks` below. */
export type RiskFact =
  | { kind: "low_fit"; label: string; score: number }
  | { kind: "early_career"; label: string }
  | { kind: "gaps"; label: string; gaps: string[] };

/** The deterministic summary as a branch discriminator + params (one entry per
 *  branch in group-eval-run's summary switch), plus the separation caveat that
 *  rides along with any crowned lead. `summary` keeps the English prose because
 *  it is ALSO the sealed decision rationale (English by convention — see the
 *  seal site in group-eval-run.ts); the client renders THIS when present. */
export type SummaryFacts = {
  kind: "empty" | "insufficient" | "no_lead" | "eligibility" | "committee" | "recommendation";
  roleTitle: string;
  count: number;
  leadLabel?: string | null;
  leadScore?: number | null;
  differentiators?: string[];
  riskCount?: number;
  // Present (and "overlapping") only when the crown needs the confidence hedge —
  // mirrors separationNote's "empty unless overlapping" rule.
  separation?: { verdict: "separated" | "overlapping" | "unknown"; leadLabel: string; runnerUpLabel: string } | null;
};

/** Why the lead is the lead, when the LLM verdict was absent and the server fell
 *  back to a canned line. `topPick.why` keeps that English prose for legacy
 *  readers; this discriminator lets the client render the localized line. */
export type TopPickWhyKind = "highest_fit" | "unscored";

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
  // The crowned lead. `entryId` is the lead's stable pipeline-entry id — the SAME
  // identity every other keyed surface in the modal uses (candIdentity). Without it a
  // duplicate display name put the lead's "Unique strengths" chips on the rival's tab.
  // Optional/additive: a payload saved before it existed (and the simulation's
  // client-side runGroupEval) falls back to matching on `label`.
  // `whyKind` (eval-speaks-your-language) is set when `why` is the server's canned
  // fallback rather than the AI verdict — the client then renders the localized
  // line and ignores the English prose. Absent ⇒ render `why` verbatim (an AI
  // verdict, already produced in the org locale, or a legacy payload).
  topPick?: { label: string; score: number | null; why: string; entryId?: string; whyKind?: TopPickWhyKind } | null;
  // Whether the crowned lead is genuinely separated from the runner-up once BOTH
  // confidence bands are taken into account (UAT L1-TOM-GEF-01). "overlapping" means
  // the point-estimate gap is inside the measurement's own uncertainty — the top two
  // are a tie on the evidence. "unknown" = not assessable (no band, no runner-up, or
  // an unscored candidate) and must never be rendered as reassurance. Absent on evals
  // saved before this existed → render no separation chrome at all.
  // Read by ComparisonTable's CandidateHeader (the "effectively tied" chip beside the
  // Lead crown) and by LegacyView's recommended-lead card, so the recruiter sees the
  // same hedge the sealed record carries — the summary prose that used to carry it is
  // discarded by AiVerdict whenever an LLM comparison exists.
  leadSeparation?: "separated" | "overlapping" | "unknown";
  recommendedOrder?: string[];
  // recommendedOrder as ranker ids (candidateId, else entryId), compared against
  // fairness.rankingIds. Absent on legacy payloads.
  recommendedIds?: string[];
  candidates?: EvalCandidate[];
  differentiators?: string[];
  // Pool-level watch-outs. Evals produced after eval-speaks-your-language carry
  // RiskFact objects (localized at render); evals saved before it carry the frozen
  // English sentences as strings and are rendered verbatim.
  risks?: (string | RiskFact)[];
  // The deterministic summary as ENGLISH prose. Still persisted because it IS the
  // sealed decision rationale (English by convention) and because a legacy reader
  // has nothing else; the modal prefers `summaryFacts` when present.
  summary?: string;
  // Structured twin of `summary` (absent on legacy payloads → the prose renders).
  summaryFacts?: SummaryFacts | null;
  // Structured AI head-to-head narrative (the modal prefers it).
  comparison?: Comparison | null;
  comparisonSource?: string | null;
  // Locale the comparison prose is actually written in, as STATED by the engine
  // (group_compare_cli's `narrativeLang`) — the deterministic synthesis is
  // English-only, so a cs/de/fr workspace that fell back holds English text here.
  // Absent on evals saved before this field existed (→ no note is rendered).
  comparisonLang?: string | null;
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
