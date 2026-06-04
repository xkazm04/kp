import type { OutboxStatus } from "@/app/_lib/comms-status";

// Summary row from GET /api/jds (the saved-JD library backing the NeedForm picker) —
// mirrors sub_analyze/AnalyzeTypes.JdSummary; kept local so the dev feature doesn't
// import the analyze feature for one row shape.
export type JdSummary = { slug: string; title: string; preview: string; created_at: string };
// A picked JD with its full body loaded (GET /api/jds/[slug]) — the body becomes
// need.jdText, the primary statement of the need.
export type SelectedJd = { slug: string; title: string; body: string };

export type NeedAnalysis = {
  realStack?: string[];
  coreResponsibilities?: string[];
  statedVsRealGaps?: string[];
  trueComplexity?: string;
  riskAreas?: string[];
  reflection?: string;
  confidence?: number;
};
export type RepoSnapshot = {
  ref?: string;
  languages?: Record<string, number>;
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
export type RubricDim = { name?: string; label?: string; weight?: number; description?: string };
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
  scenario?: { phases?: unknown[]; durationMin?: number } | null;
  status?: string;
};
export type Submission = {
  id: string;
  candidateRef: string | null;
  repoRef: string | null;
  notes: string | null;
  receivedAt: string;
  status?: string;
  evaluation?: EvalBundle | null;
  transferScore?: number | null;
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
};

export type OutboxItem = { id: string; recipient: string | null; subject: string | null; kind: string | null; channel: string | null; status: OutboxStatus; createdAt: string };

export type Reflection = {
  narrative?: string;
  iterationPattern?: string;
  deadEnds?: string[];
  readBeforeWrite?: number;
  verificationHabits?: string[];
  confidence?: number;
};
export type ProbeOutcome = { probeId?: string; kind?: string; where?: string; detected?: boolean; handledWell?: boolean; note?: string };
export type Tooling = { fluency?: number; probeOutcomes?: ProbeOutcome[]; overRelianceFlags?: string[]; evidence?: string[]; confidence?: number };
// Self-describing breakdown row echoed by the Python evaluator (evaluate.py `_ordered_dimensions`):
// canonical order + human label + weight, so the UI never hardcodes dimension metadata.
export type DimensionScore = { name: string; label: string; weight: number; score: number; description: string };
export type CaseEval = { dimensionScores?: Record<string, number>; dimensions?: DimensionScore[]; strengths?: string[]; concerns?: string[]; hasFindings?: boolean; summary?: string };
export type Transfer = { transferScore?: number; transfers?: string[]; gaps?: string[]; hasTransfers?: boolean; roleFitRationale?: string };
// One candidate-specific interview question minted from the evaluated submission
// (evaluate.mint_followups). `decision` names the observed call being verified;
// listenFor/redFlag are INTERNAL interviewer notes — render them as such, never
// candidate-facing.
export type FollowupQuestion = { id?: string; probeId?: string; decision?: string; question?: string; listenFor?: string; redFlag?: string };
export type Followups = { questions?: FollowupQuestion[] };
export type EvalBundle = { reflection?: Reflection; tooling?: Tooling; evaluation?: CaseEval; transfer?: Transfer; followups?: Followups; source?: SourceKind; perStepSources?: PerStepSources; commitCount?: number };

export const LIFECYCLE_STEPS = ["intake", "analyzed", "designed", "approved", "collecting", "ranked", "promoted"];
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
