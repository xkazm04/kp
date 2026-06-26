import type { OutboxStatus } from "@/app/_lib/comms-status";

// Summary row from GET /api/jds (the saved-JD library backing the NeedForm picker) —
// mirrors sub_analyze/AnalyzeTypes.JdSummary; kept local so the dev feature doesn't
// import the analyze feature for one row shape.
export type JdSummary = { slug: string; title: string; preview: string; created_at: string };
// A picked JD with its full body loaded (GET /api/jds/[slug]) — the body becomes
// need.jdText, the primary statement of the need.
export type SelectedJd = { slug: string; title: string; body: string };

// Live Work Surface (moonshot E) — one observed process event emitted by the
// in-product work surface. Free-form JSON (NOT a codegen'd model): persisted to
// dev_session_events and fed to the Python engine's tooling_from_events(). `t` is a
// client timestamp (ms); `path` is the seed file the event concerns.
export type ProcessEventKind = "open" | "edit" | "decision_log" | "submit";
export type ProcessEvent = { t: number; kind: ProcessEventKind; path?: string };

// One file of the materialized starter tree handed to the candidate work surface
// (seed_materializer.py output). `path` is repo-relative; `contents` is the text.
export type SeedFile = { path: string; contents: string };

// The numeric-range contract for the scoring UI
// ----------------------------------------------
// Every numeric field below is one of two domains, annotated inline and enforced
// at the render boundary by app/_lib/format (assertFraction/formatFraction for
// 0..1, assertScore for 0..100):
//   - FRACTION (0..1): a confidence / fluency / read-before-write / rubric weight /
//     language share — rendered as a percent (0.73 -> "73%").
//   - SCORE (0..100): a capability score / transferScore — rendered raw.
// These mirror the ranges pinned on the Python producer (pipeline/jobfit/devcase/
// models.py); the guards turn a unit-swap (a confidence emitted as 85 not 0.85)
// into a caught "[range-contract]" warning + clamp instead of an absurd "8500%".
export type NeedAnalysis = {
  realStack?: string[];
  coreResponsibilities?: string[];
  statedVsRealGaps?: string[];
  trueComplexity?: string;
  riskAreas?: string[];
  reflection?: string;
  confidence?: number; // FRACTION 0..1 — trust in this inference (see models.py "Confidence scale")
};
export type RepoSnapshot = {
  ref?: string;
  languages?: Record<string, number>; // name -> FRACTION 0..1 (language share of the repo)
  inferredStack?: string[];
  topDirs?: string[];
  recentCommitSummaries?: string[];
  loc?: number;
  readmeExcerpt?: string;
};
// Provenance of a pipeline step or whole run: a real LLM call (`llm`), a mixed
// run where some steps fell back to deterministic templates (`partial`), or a
// fully templated/deterministic run (`deterministic`). Typed as a union so a typo
// or a new state can't silently slip past the label / colour / degraded checks.
export type SourceKind = "llm" | "partial" | "deterministic";
// Presentation contract for a SourceKind, produced by `describeSource` (DevHelpers)
// so the chip colour, label and degraded warning are decided in exactly one place.
export type SourceDescriptor = { label: string; dotClass: string; textClass: string; isDegraded: boolean };
// `perStepSources` ({step: SourceKind}) comes from the uniform CLI provenance
// envelope; the ProvenanceStrip renders it, falling back to `source` for bundles
// saved before it existed. Per-step values are "llm" or "deterministic".
export type PerStepSources = Record<string, SourceKind>;
// `snapshots` (multi-repo grounding, up to MAX_CODEBASES) is what the UI renders;
// `snapshot` (= first of them) survives for bundles saved before multi-repo existed.
export type Result = { analysis?: NeedAnalysis; snapshot?: RepoSnapshot | null; snapshots?: RepoSnapshot[]; source?: SourceKind; perStepSources?: PerStepSources };

export type CoverProbe = { id?: string; kind?: string; where?: string; reveals?: string; decisionSpace?: string[] };
export type RubricDim = { name?: string; label?: string; weight?: number /* FRACTION 0..1 */; description?: string };
export type RoleSpec = { title?: string; seniority?: string; mustHaves?: string[]; niceToHaves?: string[]; responsibilities?: string[] };
export type CaseScenario = { title?: string; brief?: string; repoSeed?: string; tasks?: string[]; coverProbes?: CoverProbe[]; rubricDimensions?: RubricDim[]; timeboxHours?: number };
export type Design = { role?: RoleSpec; case?: CaseScenario; source?: SourceKind; perStepSources?: PerStepSources };
export type ApprovedCase = { id: string; title: string | null; roleTitle: string | null; seniority: string | null; createdAt: string };
// The full record GET /api/devcase actually returns per case (listDevCases sends the
// whole row, JSON parsed) — the Cases tab table uses the summary fields and the detail
// reader uses role/case/scenario without a second fetch.
export type DevCaseDetail = ApprovedCase & {
  role?: RoleSpec | null;
  case?: CaseScenario | null;
  // `source` is the generation provenance the orchestrator persists INSIDE each blob
  // ("llm" = case-grounded, "deterministic" = template fallback) so the detail header
  // can badge a degraded state. Absent on records saved before provenance was persisted.
  scenario?: { phases?: unknown[]; durationMin?: number; source?: SourceKind } | null;
  // The materialized seed — a "deterministic" seed is the prose-only README + DECISIONS
  // skeleton (seed_materializer.deterministic_seed), not concrete starter files.
  seed?: { files?: unknown[]; note?: string; source?: SourceKind } | null;
  status?: string;
};
export type Submission = {
  id: string;
  candidateRef: string | null;
  repoRef: string | null;
  notes: string | null;
  /** Email/phone captured at apply — the API has always served it (rowToSubmission);
   *  this type dropped it, so the workbench couldn't show how to reach a winner. */
  contact?: string | null;
  receivedAt: string;
  status?: string;
  evaluation?: EvalBundle | null;
  transferScore?: number | null; // SCORE 0..100 (mirror of evaluation.transfer.transferScore)
  /** Latest recorded outcome, joined by the postings GET from the dev-outcomes store
   *  (submission.id is the `ref` by contract). Server truth for the outcome pill —
   *  without it the "recorded" state lived only in SubmissionRow and any remount
   *  re-offered the buttons, double-counting re-records in calibration. */
  outcome?: { outcome: "hired" | "rejected" | "withdrawn" | "pending"; performance: number | null; recordedAt: string } | null;
};
export type Posting = {
  id: string;
  caseId: string | null;
  channel: string;
  token: string | null;
  roleTitle: string | null;
  caseTitle: string | null;
  submissionCount?: number;
  submissions?: Submission[];
};
export type Lifecycle = {
  id: string;
  title: string | null;
  stage: string;
  auto: boolean;
  detail: string | null;
  caseId: string | null;
  postingId: string | null;
  createdAt: string;
  updatedAt?: string | null;
  // W5-4 — the designed artifacts the GET has always served but this type
  // dropped, leaving the human gate blind: the reality-reflection that flagged
  // the design, and the role/case under review.
  analysis?: { statedVsRealGaps?: string[]; riskAreas?: string[]; confidence?: number } | null;
  role?: RoleSpec | null;
  case?: CaseScenario | null;
};

export type OutboxItem = { id: string; recipient: string | null; subject: string | null; kind: string | null; channel: string | null; status: OutboxStatus; createdAt: string };

export type Reflection = {
  narrative?: string;
  iterationPattern?: string;
  deadEnds?: string[];
  readBeforeWrite?: number; // FRACTION 0..1 — evidence they read before generating
  verificationHabits?: string[];
  confidence?: number; // FRACTION 0..1 — trust in this inference
};
// handledWell is tri-state: true / false when handling was graded (LLM path), or
// null/undefined when only DETECTED (observed Live Work Surface path — handling not
// gradeable from process). Consumers must treat null as "unknown", not "failed".
export type ProbeOutcome = { probeId?: string; kind?: string; where?: string; detected?: boolean; handledWell?: boolean | null; note?: string };
export type Tooling = { fluency?: number /* FRACTION 0..1 */; probeOutcomes?: ProbeOutcome[]; overRelianceFlags?: string[]; evidence?: string[]; confidence?: number /* FRACTION 0..1 */ };
// Self-describing breakdown row echoed by the Python evaluator (evaluate.py `_ordered_dimensions`):
// canonical order + human label + weight, so the UI never hardcodes dimension metadata. `score`
// is a MIRROR of `dimensionScores[name]` — never an independent number (see CaseEval below).
export type DimensionScore = { name: string; label: string; weight: number /* FRACTION 0..1 */; score: number /* SCORE 0..100 */; description: string };
// Canonical-score contract (mirrors models.CaseEvaluation): `dimensionScores` (name -> 0..100) is
// the single source of truth for the capability numbers; `dimensions` is its derived, ordered,
// weight-annotated projection for the UI (each row.score === dimensionScores[row.name], enforced
// Python-side). There is no per-capability scalar — the structural axis IS `architecture`. The
// UI prefers `dimensions`, falling back to `dimensionScores` only for bundles saved before it.
// `confidence` is PROPAGATED, not self-rated: the min of the upstream reflection/tooling
// confidences (see models.py "Confidence scale"), so a decision built on a deterministic-fallback
// signal carries that signal's low confidence and never reads as authoritative.
export type CaseEval = { dimensionScores?: Record<string, number> /* name -> SCORE 0..100 */; dimensions?: DimensionScore[]; strengths?: string[]; concerns?: string[]; hasFindings?: boolean; summary?: string; confidence?: number /* FRACTION 0..1 — propagated from upstream evidence */ };
// `confidence` is inherited from the evaluation it scores (transfer is derived purely from it).
export type Transfer = { transferScore?: number /* SCORE 0..100 */; transfers?: string[]; gaps?: string[]; hasTransfers?: boolean; roleFitRationale?: string; confidence?: number /* FRACTION 0..1 — inherited from the evaluation */ };
// One candidate-specific interview question minted from the evaluated submission
// (evaluate.mint_followups). `decision` names the observed call being verified;
// listenFor/redFlag are INTERNAL interviewer notes — render them as such, never
// candidate-facing.
export type FollowupQuestion = { id?: string; probeId?: string; decision?: string; question?: string; listenFor?: string; redFlag?: string };
export type Followups = { questions?: FollowupQuestion[] };
// Deterministic process-trace telemetry persisted with every bundle (devcase-run.ts):
// whether the mandated DECISIONS log was kept, and the commit cadence — a
// how-they-worked signal beside the LLM's interpretation, NOT a verdict.
export type ProcessTrace = {
  commitCount?: number;
  cadence?: { count?: number; spanHours?: number | null; bursty?: boolean | null } | null;
  decisionsLogPresent?: boolean;
};
// ce28da40 — process-authenticity verdict derived from the trace + reflection
// (app/_lib/devcase-authenticity.ts): is this genuine incremental work or a likely
// paste-from-LLM? `band` "suspect" holds the submission for the ownership-verifying
// interview rather than auto-advancing on transfer score. Absent on older bundles.
export type Authenticity = { score: number /* SCORE 0..100 */; band: "authentic" | "mixed" | "suspect"; reasons: string[] };
// c364a44d — seed-anchored engagement: which planted seam files the submission
// touched (app/_lib/devcase-seed-diff.ts). Grounded, mechanically comparable
// evidence beside the LLM probe read. Absent on bundles saved before it / cases
// with no materialized seed.
export type SeedDiff = { files: { path: string; touched: boolean }[]; touched: number; total: number; untouched: string[] };
export type EvalBundle = { reflection?: Reflection; tooling?: Tooling; evaluation?: CaseEval; transfer?: Transfer; followups?: Followups; authenticity?: Authenticity | null; seedDiff?: SeedDiff | null; source?: SourceKind; perStepSources?: PerStepSources; commitCount?: number; processTrace?: ProcessTrace | null };

// At or below this a confidence (self-rated OR propagated) is "low" — the reviewer is warned the
// inference is thin/ungrounded, or a decision rests on such evidence. Mirrors LOW_CONFIDENCE in
// pipeline/jobfit/devcase/models.py (and the `threshold` the CLI confidence block emits).
export const LOW_CONFIDENCE = 0.4;

export const LIFECYCLE_STEPS = ["intake", "analyzed", "designed", "approved", "collecting", "ranked", "promoted"];
// Post-publication "live" stages: the case is accepting/ranking candidates (or
// has promoted one) rather than sitting pre-publication or at the approval gate.
// Gates the "Close case" action (LifecycleRow) and the moss "live" stage tint
// (CasesTable) — one source so a stage can't read "live" in one place but not
// be closable in the other.
export const LIVE_STAGES = ["published", "collecting", "ranked", "promoted"] as const;
export const STAGE_LABEL: Record<string, string> = {
  intake: "intake",
  analyzed: "analyzed",
  designed: "designed",
  awaiting_approval: "needs approval",
  approved: "approved",
  published: "published",
  collecting: "collecting",
  ranked: "ranked",
  promoted: "promoted",
};

export const COMPLEXITY: Record<string, string> = {
  low: "bg-moss/15 text-moss",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-coral/15 text-coral",
};
