import type { OutboxStatus } from "@/app/_lib/comms-status";
// Single-sourced from the generated schema (superset of the old local shape —
// adds roleFamily/languages/promptVersion); see app/_lib/rolespec.ts.
import type { RoleBrief, RoleSpec } from "@/app/_lib/rolespec";
import type { JudgeIndependence } from "@/app/_lib/devcase-judge-independence";

// Summary row from GET /api/jds (the saved-JD library backing the NeedForm picker) —
// mirrors sub_analyze/AnalyzeTypes.JdSummary; kept local so the dev feature doesn't
// import the analyze feature for one row shape.
export type JdSummary = { slug: string; title: string; preview: string; created_at: string };
// A picked JD with its full body loaded (GET /api/jds/[slug]?brief=1) — the body
// becomes need.jdText, the primary statement of the need. `brief` is the promoted
// role-intake RoleBrief behind the JD (null/absent when none): its graded
// requirements + outcomes fill the need's structured fields instead of being
// re-extracted from markdown (UAT L1-EVA-3).
export type SelectedJd = { slug: string; title: string; body: string; brief?: RoleBrief | null };

// Live Work Surface (moonshot E) — one observed process event emitted by the
// in-product work surface. Free-form JSON (NOT a codegen'd model): persisted to
// dev_session_events and fed to the Python engine's tooling_from_events(). `t` is a
// client timestamp (ms); `path` is the seed file the event concerns.
// "prompt" (a captured assistant/stakeholder exchange; path = channel) and
// "perturbation" (the mid-flight requirement change was revealed) are SERVER-
// recorded kinds — the flush route rejects them from client payloads.
export type ProcessEventKind = "open" | "edit" | "decision_log" | "submit" | "paste" | "prompt" | "perturbation";
// `size` carries the char count for a "paste" event (bulk-paste authenticity signal);
// absent for other kinds. We record paste MAGNITUDE only — never the pasted content.
export type ProcessEvent = { t: number; kind: ProcessEventKind; path?: string; size?: number };

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
// `labelKey` is a CATALOG KEY, never prose: the descriptor is computed in a plain
// module with no translator in scope, so it names the string and the rendering
// component resolves it in the reader's language (`devcase.provenance.source.*`).
export type SourceDescriptor = { labelKey: SourceKind; dotClass: string; textClass: string; isDegraded: boolean };
// `perStepSources` ({step: SourceKind}) comes from the uniform CLI provenance
// envelope; the ProvenanceStrip renders it, falling back to `source` for bundles
// saved before it existed. Per-step values are "llm" or "deterministic".
export type PerStepSources = Record<string, SourceKind>;
// `snapshots` (multi-repo grounding, up to MAX_CODEBASES) is what the UI renders;
// `snapshot` (= first of them) survives for bundles saved before multi-repo existed.
export type Result = { analysis?: NeedAnalysis; snapshot?: RepoSnapshot | null; snapshots?: RepoSnapshot[]; source?: SourceKind; perStepSources?: PerStepSources };

export type CoverProbe = { id?: string; kind?: string; where?: string; reveals?: string; decisionSpace?: string[] };
export type RubricDim = { name?: string; label?: string; weight?: number /* FRACTION 0..1 */; description?: string };
export type { RoleSpec };
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
  // ONE THREAD (db/devcase.ts DevCaseRecord): the job this assignment was cut for, its
  // title joined at read, and the JD the recruiter actually picked. `jobId` null with
  // `jdSlug` set is a real, expected state — a saved JD whose best-effort Job ingest
  // never ran — and the detail header says so rather than showing nothing.
  jobId?: string | null;
  jobTitle?: string | null;
  jdSlug?: string | null;
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
  /** Minutes past the case timebox, measured server-side at finalize (/perfect wave
   *  42a). 0 = measured and inside the box, null = not measured (a repo-link
   *  submission, or a row written before the column existed). A recruiter comparing
   *  two submissions is otherwise comparing a 90-minute attempt with an eight-hour one
   *  and cannot tell. */
  overTimeboxMinutes?: number | null;
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

// One dev_outbox row exactly as GET /api/devcase/comms serves it (listOutbox returns
// the whole OutboxEntry). `ref` and `body` are NOT decoration: the outbox is
// APPEND-ONLY — a later same-(ref,kind) row supersedes an earlier one — so a `bounced`
// receipt supersedes the green `sent` it concerns and a successful resend supersedes a
// dead letter, and `deriveCommsView` needs both fields to fold that log into a delivery
// verdict. This type used to declare only the subset the table happened to render,
// which is exactly why this surface projected the RAW `status` column and disagreed
// with the Comms Center about the same message (see outboxView.ts).
export type OutboxItem = {
  id: string;
  recipient: string | null;
  subject: string | null;
  kind: string | null;
  channel: string | null;
  status: OutboxStatus;
  createdAt: string;
  /** Pipeline entry / submission id this message concerns — the supersession key. */
  ref?: string | null;
  /** A `bounced` receipt carries the relay's reported reason in its body. */
  body?: string | null;
  /** WHY a `failed` row dead-lettered; null on every other row. */
  failureDetail?: string | null;
};

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
// The OBSERVED process signals `process_events.derive_signals` emits, carried on
// the tooling block as `signals` (process_events.py "Raw observed signals, exposed
// for downstream deterministic consumers"). Present ONLY for a Live Work Surface
// submission — the repo path reconstructs from commit metadata and has no watched
// event stream, so `signals` is absent there and that absence is meaningful.
//
// This is the observed counterpart to `ProcessTrace.cadence`, which is git-only:
// a live session has no commits by design, so cadence is null for it and these
// numbers are the honest substitute. `editsAfterPerturbation` /
// `decisionsAfterPerturbation` are null when the mid-flight requirement change was
// never shown (no signal — not zero adaptation).
export type ObservedSignals = {
  filesOpened?: number;
  filesEdited?: number;
  readBeforeWrite?: number; // FRACTION 0..1 — from event ORDER, not inference
  decisionLogEntries?: number;
  editedTest?: boolean;
  editedDecisions?: boolean;
  iterationPattern?: string; // "iterative" | "single-pass" (open vocabulary on the wire)
  perturbationShown?: boolean;
  editsAfterPerturbation?: number | null;
  decisionsAfterPerturbation?: number | null;
  promptExchanges?: number;
};
export type Tooling = { fluency?: number /* FRACTION 0..1 */; probeOutcomes?: ProbeOutcome[]; overRelianceFlags?: string[]; evidence?: string[]; signals?: ObservedSignals | null; confidence?: number /* FRACTION 0..1 */ };
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
// The `reasons` are FINDINGS, not copy: `{ kind, params }`, rendered through
// `devcase.evalPanel.authenticityReason.*` in the reader's language. Bundles are
// PERSISTED, so a panel is still handed runs saved while the producer pushed English
// sentences — hence the `| string` arm, which the panel renders verbatim (it is the
// prose that run actually produced) rather than dropping evidence it cannot re-key.
export type AuthenticityReason = { kind: string; params?: Record<string, number> };
export type Authenticity = { score: number /* SCORE 0..100 */; band: "authentic" | "mixed" | "suspect"; reasons: (AuthenticityReason | string)[] };
// c364a44d — seed-anchored engagement: which planted seam files the submission
// touched (app/_lib/devcase-seed-diff.ts). Grounded, mechanically comparable
// evidence beside the LLM probe read. Absent on bundles saved before it / cases
// with no materialized seed.
export type SeedDiff = { files: { path: string; touched: boolean }[]; touched: number; total: number; untouched: string[] };
// ---- LLM-era anti-delegation controls: the evidence layer -------------------
//
// Everything below was already COMPUTED and persisted with the bundle
// (devcase-run.ts) but was never declared here, so no reviewer surface could
// read it. These types are the projection contract; the panels that render them
// are DevEvalPanelIntegrity / DevEvalPanelChecks.

// Control #1 — hash-chain verdict over the observed event log
// (db/devcase.ts `verifyDevSessionChain`). `valid: null` is UNVERIFIABLE (no
// events, or legacy NULL-hash rows) and is explicitly NOT evidence of tampering:
// only `false` means a link failed to recompute.
export type ChainVerdict = { valid: boolean | null; events: number; brokenAtSeq: number | null };
// Control #1/#4 — the persisted tamper-evidence verdict (db/devcase.ts
// `SessionIntegrity`; mirrored here rather than imported so a client component
// never pulls the server DB module into the bundle). `watermark.expected` is the
// raw per-session marker: it rides in the blob but must NEVER be rendered —
// showing it teaches a candidate exactly what to strip.
export type Integrity = {
  chain: ChainVerdict;
  backdatedEvents: number;
  maxClockDriftMs: number;
  watermark: { expected: string; present: boolean; foreign: string[] };
};

// Control #3 — one planted-canary verdict (pipeline/.../artifact_checks.py
// `canary_outcomes`). FOUR-WAY, and the four are not a pass/fail binary:
//   addressed    — the flawed fragment is gone from the submitted file
//   flagged      — flaw left in place but called out in DECISIONS / the dialogue
//   propagated   — the planted flaw SURVIVED into the submission
//   unverifiable — not mechanically gradable (fragment not found in the seed, or
//                  the submitted file does not descend from the seed version).
//                  Honest darkness: never scored, never shown as a pass.
export const CANARY_STATUSES = ["addressed", "flagged", "propagated", "unverifiable"] as const;
export type CanaryStatus = (typeof CANARY_STATUSES)[number];
// `status` stays a plain string on the wire (free-form JSON from Python, not a
// codegen'd model); the UI narrows it through CANARY_STATUSES and falls back to a
// neutral "unverifiable" presentation for anything unrecognized.
export type CanaryOutcome = { id?: string; kind?: string; path?: string; status?: string; note?: string; reveals?: string };

// Control #6 — distance from the frozen one-shot naive-LLM baseline
// (artifact_checks.baseline_similarity). `available: false` means the case never
// froze a baseline (the LLM was unavailable at approval —
// devcase-orchestrator.ts records a `baseline_unavailable` audit) so the
// comparison did not run. THIS IS NEVER A PENALTY: high similarity only aims the
// authorship interview. The UI must not present it as a score.
export type BaselineSimilarity = {
  available?: boolean;
  bestSimilarity?: number; // FRACTION 0..1
  perBaseline?: { baseline: number; similarity: number; comparedPaths: number }[];
};

// Control #2 — deterministic signals over the CAPTURED assistant/stakeholder
// transcript (prompt_signals.derive_prompt_signals). FAIRNESS CONTRACT: using the
// assistant is never a penalty — zero prompts is "no signal", heavy use is graded
// on quality, never volume. `briefPasteRatio` (how much of the brief the most
// brief-like prompt contained) is the one negative-leaning signal and even it only
// aims the interview.
export type PromptSignals = {
  observed?: boolean;
  assistantPrompts?: number;
  stakeholderQuestions?: number;
  clarifyingQuestions?: number;
  verificationAsks?: number;
  meanPromptChars?: number;
  iterationDepth?: number;
  briefPasteRatio?: number; // FRACTION 0..1
  confidence?: number; // FRACTION 0..1
};

// The mechanical observed-check verdicts persisted beside the LLM interpretation
// that consumed them (devcase_cli `extras`). Each key is present only when its
// inputs were: `{}` for a repo submission (no observed inputs at all), and e.g.
// no `canaryOutcomes` when the case's seed planted none. Consumers must tell
// "the check did not run" from "the check passed".
export type ObservedChecks = {
  promptSignals?: PromptSignals;
  promptEvidence?: string[];
  canaryOutcomes?: CanaryOutcome[];
  baselineSimilarity?: BaselineSimilarity;
  checkEvidence?: string[];
};

// Gap 5 — the seat identities behind this evaluation (which engine+model produced it,
// which one the `devcase_judge` gate resolves to, whether they differ). The type and
// its RENDERING RULE live together in the pure lib module — only the self-grading
// state is shown, and "absent" covers both a legacy bundle and a keyless
// deterministic run — so this is a re-export, not a second declaration.
export type { JudgeIndependence };

export type EvalBundle = { reflection?: Reflection; tooling?: Tooling; evaluation?: CaseEval; transfer?: Transfer; followups?: Followups; authenticity?: Authenticity | null; seedDiff?: SeedDiff | null; integrity?: Integrity | null; observedChecks?: ObservedChecks; judgeIndependence?: JudgeIndependence | null; source?: SourceKind; perStepSources?: PerStepSources; commitCount?: number; processTrace?: ProcessTrace | null };

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

// ---- Canonical vocabularies -------------------------------------------------
//
// Each tuple below is ONE declaration of an enum whose producer lives elsewhere
// (the orchestrator, or the Python engine). Two guards keep every one of them
// honest, and both are required — neither catches what the other does:
//
//   1. PRODUCER equality — `devcase-vocabulary.test.ts` reads the producing source
//      and asserts set equality with the tuple. Without it the tuple is a copy that
//      silently rots the moment the producer gains a value.
//   2. CATALOG equality — the same test pins all four i18n catalogs to the tuple by
//      set equality, in both directions. `npm run i18n:check` compares the locales
//      to EACH OTHER and never to the domain vocabulary, so deleting a key from all
//      four leaves it green; typecheck is silent too, because every one of these
//      lookups is a template-string key. A missing key surfaces only at runtime, as
//      a raw English code inside an otherwise translated panel.
//
// This is the mechanism `_ordered_dimensions` established for rubric dimensions
// (the engine emits name/label/weight/description so the UI hardcodes none of it),
// carried to the enums the engine does NOT annotate. Note the deliberate difference:
// for a LOCALIZED surface the engine can be canonical only for the VOCABULARY, never
// for the label — a label emitted from Python is English by construction. So the
// producer owns the key set and the i18n catalog owns the words.

// Every stage `devcase-orchestrator.ts` STAGES can put on a lifecycle. Ten, not the
// nine the old STAGE_LABEL listed: `closed` is reachable through the W5-3 close-out
// action (LifecycleRow) and was rendering as the raw id in both the table and the row.
export const LIFECYCLE_STAGES = [
  "intake",
  "analyzed",
  "designed",
  "awaiting_approval",
  "approved",
  "published",
  "collecting",
  "ranked",
  "promoted",
  "closed",
] as const;

// Cover-probe kinds — the designed ambiguities/traps a case plants. Producer:
// pipeline/jobfit/devcase/design.py PROBE_KINDS.
export const PROBE_KINDS = ["ambiguity", "legacy_trap", "verification_trap", "underspecified"] as const;

// Canary kinds — what a planted known-ground-truth flaw IS. Producer:
// pipeline/jobfit/devcase/seed_materializer.py CANARY_KINDS.
export const CANARY_KINDS = ["wrong_constant", "stale_doc", "misleading_comment", "subtle_bug"] as const;

// Probe-outcome presentation states. UI-derived (there is no producer to pin to):
// `ProbeOutcome.handledWell` is TRI-state and `detected` is independent, so the four
// combinations that carry distinct meaning get distinct states. `detected` here means
// "worked the area, handling not graded" — the observed Live Work Surface path emits
// handledWell=null by design, and reporting that as `missed` turned an absence of
// assessment into a finding against the candidate.
export const PROBE_STATUSES = ["handled", "unhandled", "detected", "missed"] as const;
export type ProbeStatus = (typeof PROBE_STATUSES)[number];

// The five durable capabilities. Producer: pipeline/jobfit/devcase/models.py
// RUBRIC_DIMENSIONS. Current bundles carry their own labels on `dimensions`
// (_ordered_dimensions), so this set is read only for the pre-`dimensions` fallback —
// which is exactly why it needs a guard: nothing else would ever notice it rotting.
export const RUBRIC_DIMENSION_NAMES = ["framing", "tooling", "judgment", "architecture", "transfer"] as const;

// The six anti-delegation controls as MARKETED on the Cases-tab empty state, in
// reading order. Not a producer-owned enum — it is the editorial list, pinned here so
// the vocabulary guard can hold all four locales to exactly six controls and stop a
// translated catalog from quietly shipping five. The truth contract that keeps this
// list equal to the six the engine actually runs lives in DevCasesEmptyLedger.tsx and
// in docs/features/dev-case/README.md ("The marketed list is the implemented list").
export const LEDGER_CONTROL_IDS = [
  "hashChain",
  "promptCapture",
  "canaries",
  "perturbation",
  "watermark",
  "baseline",
] as const;

export const COMPLEXITY: Record<string, string> = {
  low: "bg-moss/15 text-moss",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-coral/15 text-coral",
};
