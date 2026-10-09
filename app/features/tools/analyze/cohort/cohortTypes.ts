// The Cohort Studio wire contract (Analyze v2, spark analyze-v2-cohort).
//
// CLIENT-SAFE by construction: no import here reaches the database, the filesystem
// or a server-only module, so the studio shell, the three prototype worlds, the
// dimension pages, the pure engine (cohortProject / cohortClaims) and the server
// routes all read the SAME declarations. Every literal array is the single source
// of its union and carries a runtime guard (the tabs.ts / i18n/locales.ts shape).
//
// The comparative claims follow the registry's comparative-shortlist-evaluation:
// an ordering is always available, a LEAD is a claim. Claims are decided by code
// (cohortClaims.ts) and the language model never changes them; it only writes the
// rare cell comments and the top-NARRATIVE_TOP narrative.

/** The ceiling of one cohort. Read by the proposal, the POST route, the runner and the UI. */
export const COHORT_CAP = 20;
/** The head-to-head floor: below it there is no leader, no separation, no robustness. */
export const COHORT_MIN = 2;
/** The comparative narrative covers the strongest N by fit, and says who it leaves out. */
export const NARRATIVE_TOP = 6;

export const COHORT_DIMENSIONS = ["fit", "skills", "experience", "signals", "trust", "salary", "publicWork"] as const;
export type CohortDimension = (typeof COHORT_DIMENSIONS)[number];
export const isCohortDimension = (v: unknown): v is CohortDimension =>
  typeof v === "string" && (COHORT_DIMENSIONS as readonly string[]).includes(v);

/** Role families whose candidates get their CV-linked GitHub read automatically. */
export const TECHNICAL_FAMILIES = ["software_engineering", "data_ai"] as const;
export const isTechnicalFamily = (v: unknown): boolean =>
  typeof v === "string" && (TECHNICAL_FAMILIES as readonly string[]).includes(v);

/** The switcher. `v1` is the baseline (the upload form) and stays production's view until the
 * nested-layer round closes; Line-up won the world round (Loom and Console were deleted). */
export const COHORT_VARIANTS = ["v1", "lineup"] as const;
export type CohortVariant = (typeof COHORT_VARIANTS)[number];
export const isCohortVariant = (v: unknown): v is CohortVariant =>
  typeof v === "string" && (COHORT_VARIANTS as readonly string[]).includes(v);

// ---- Membership (who is in the set, and by which rule) -------------------------

/** applicant = filed under the job's pipeline; matched = pool top-up by deterministic rank; added = by hand. */
export const MEMBERSHIPS = ["applicant", "matched", "added"] as const;
export type Membership = (typeof MEMBERSHIPS)[number];

/** Where a member's CV comes from. memberId is the analysis slug, or `profile:<id>`. */
export type MemberSource = { kind: "analysis"; slug: string } | { kind: "profile"; id: string };

export interface ProposalMember {
  memberId: string;
  label: string;
  source: MemberSource;
  membership: Membership;
  roleFamily: string | null;
  seniority: string | null;
  /** Deterministic pool rank score (0-100) used to order the proposal; null for applicants without one. */
  matchScore: number | null;
  /** An analysis of this CV against THIS JD already exists: the run reuses it and spends nothing. */
  reusable: boolean;
}

export interface CohortProposal {
  jdSlug: string;
  jdTitle: string;
  /** Composed from organizations + jobs.company + the JD's build intent; null when none of them say anything. */
  companyText: string | null;
  orgName: string | null;
  members: ProposalMember[];
  /** Candidates the cap left out, by rule — the registry requires saying how many. */
  leftOut: { applicants: number; matched: number };
  cap: typeof COHORT_CAP;
  /** members.length minus reusable members: the number of ai_candidates units the run would spend (metered installs). */
  freshCount: number;
}

// ---- The run -------------------------------------------------------------------

export const COHORT_STATUSES = ["queued", "running", "done", "failed"] as const;
export type CohortStatus = (typeof COHORT_STATUSES)[number];

export const MEMBER_RUN_STATES = ["queued", "reused", "analyzing", "done", "failed"] as const;
export type MemberRunState = (typeof MEMBER_RUN_STATES)[number];

/** POST /api/analyze/cohort body. */
export interface CohortRunRequest {
  jdSlug: string;
  members: Array<{ memberId: string; membership: Membership }>;
  blind: boolean;
  reportLang: string;
}
/** POST /api/analyze/cohort response. */
export interface CohortRunResponse {
  cohortId: string;
  taskId: string;
}

// ---- Cells: the comparison layer -----------------------------------------------

/** strong/solid/thin/weak are rating bands; `absent` is its own tier (never a 0). */
export const CELL_TIERS = ["strong", "solid", "thin", "weak", "absent"] as const;
export type CellTier = (typeof CELL_TIERS)[number];

/** Why a cell has no rating. `pending` = the member's analysis has not landed yet. */
export const ABSENT_REASONS = ["pending", "notRead", "notTechnical", "noLink", "currencyMismatch", "noJdFit", "failed", "blind"] as const;
export type AbsentReason = (typeof ABSENT_REASONS)[number];

/**
 * A short label is DATA, rendered by the UI in the reader's language:
 * `key` names a message under `analyzeCohort.labels`, `params` are the ICU values.
 */
export interface ShortLabel {
  key: string;
  params?: Record<string, string | number>;
}

export interface CohortCell {
  dimension: CohortDimension;
  /** 0-100, or null when tier === "absent". */
  rating: number | null;
  tier: CellTier;
  /** Present iff tier === "absent". */
  absentReason?: AbsentReason;
  label: ShortLabel;
  /** The rare short model comment, in the report language. Omitted (not "") when there is none. */
  comment?: string;
  /** Uncertainty band around `rating` (inclusive), with the named reasons that widened it. Omitted when absent. */
  band?: { lo: number; hi: number; drivers: ShortLabel[] };
}

// ---- Per-dimension detail (what each drill-in page reads) ------------------------

export interface FitDetail {
  dimension: "fit";
  jobFitScore: number | null;
  total: number | null;
  seniorityAlignment: string | null;
  roleAlignment: string | null;
  summary: string | null;
  riskFlags: string[];
}
export interface SkillsDetail {
  dimension: "skills";
  matched: string[];
  missing: string[];
  unproven: string[];
  /** Skills listed on the CV that the JD did not ask for. */
  extra: string[];
}
export interface ExperienceDetail {
  dimension: "experience";
  years: number | null;
  seniority: string | null;
  roleFamily: string | null;
  educationLevel: string | null;
  evidence: string[];
}
export interface SignalsDetail {
  dimension: "signals";
  strengths: Array<{ label: string; detail: string; probe: string | null; confidence: number | null }>;
  antipatterns: Array<{ label: string; detail: string; probe: string | null; confidence: number | null }>;
}
export interface TrustDetail {
  dimension: "trust";
  findings: Array<{ code: string; severity: "ok" | "warn" | "blocker"; scope: string; text: string }>;
}
export interface SalaryDetail {
  dimension: "salary";
  currency: string | null;
  period: string | null;
  minimum: number | null;
  maximum: number | null;
  midpoint: number | null;
  confidence: string | null;
}
export interface PublicWorkDetail {
  dimension: "publicWork";
  /** The GitHub login read, or null when none was. */
  username: string | null;
  profileUrl: string | null;
  publicRepos: number | null;
  totalStars: number | null;
  activeRepos: number | null;
  languages: Array<{ name: string; percent: number }>;
  topRepos: Array<{ name: string; url: string; language: string | null; stars: number }>;
  matchedSkills: string[];
  potentialGaps: string[];
}
export type DimensionDetail =
  | FitDetail
  | SkillsDetail
  | ExperienceDetail
  | SignalsDetail
  | TrustDetail
  | SalaryDetail
  | PublicWorkDetail;
export type DetailFor<D extends CohortDimension> = Extract<DimensionDetail, { dimension: D }>;

// ---- The member as the comparison sees it --------------------------------------

export interface CohortMember {
  memberId: string;
  /** In a blind cohort this is "Candidate A".."T" (letters by neutral order), never the name. */
  label: string;
  membership: Membership;
  runState: MemberRunState;
  /** The saved analysis behind this member (opens the full single report); null until it lands. */
  analysisSlug: string | null;
  roleFamily: string | null;
  /** Neutral presentation position (stable shuffle keyed on the cohort id) — NOT the rank. */
  neutralIndex: number;
  /** 1-based rank by overall fit among members with a fit rating; null when fit is absent. */
  fitRank: number | null;
  /** Dominated on every compared dimension by another member (the decoy flag). */
  decoyOf: string | null;
  cells: Record<CohortDimension, CohortCell>;
  detail: { [D in CohortDimension]: DetailFor<D> | null };
  /** Why each rating sits where it does (round 2). null where the cell is absent. */
  why: Record<CohortDimension, MemberDimensionWhy | null>;
}

// ---- Claims: decided by code ---------------------------------------------------

/** clears = the lead's gap is wider than the bands; insideNoise = ordered but not separated; belowFloor = < COHORT_MIN rated. */
export const SEPARATIONS = ["clears", "insideNoise", "belowFloor"] as const;
export type Separation = (typeof SEPARATIONS)[number];

/** stable = the leader holds under every weight scheme; sensitive = it changes under some; undetermined = not computable. */
export const ROBUSTNESS = ["stable", "sensitive", "undetermined"] as const;
export type Robustness = (typeof ROBUSTNESS)[number];

export interface DimensionClaim {
  dimension: CohortDimension;
  /** memberId of the leader, or null when no lead may be named. */
  leader: string | null;
  separation: Separation;
  /** How many members carry a rating on this dimension (absent ones are not counted). */
  rated: number;
  /** The short model note for this dimension's page, reorder-surviving only. Omitted when none. */
  note?: string;
  /** Refused comparisons (e.g. salary across currencies): the partition keys, else omitted. */
  partitions?: Array<{ key: string; memberIds: string[] }>;
}

export interface CohortClaims {
  overall: { leader: string | null; separation: Separation; robustness: Robustness };
  byDimension: Record<CohortDimension, DimensionClaim>;
}

export interface CohortNarrative {
  /** The strongest NARRATIVE_TOP by fit, in the order the narrative discusses them. */
  covers: string[];
  /** Members the narrative does not discuss (it says so). */
  leavesOut: number;
  text: string;
  /** keyless = the deterministic fallback wrote it. */
  engine: "model" | "keyless";
}

/** GET /api/analyze/cohort/[id] — the whole comparison, projected (never raw store rows). */
export interface CohortView {
  cohortId: string;
  status: CohortStatus;
  jdSlug: string;
  jdTitle: string;
  orgName: string | null;
  blind: boolean;
  reportLang: string;
  createdAt: string;
  finishedAt: string | null;
  members: CohortMember[];
  claims: CohortClaims;
  /** null until the comparative pass ran (or when fewer than COHORT_MIN members are rated). */
  narrative: CohortNarrative | null;
  /** Counts for the run sheet / progress. */
  progress: { total: number; done: number; reused: number; failed: number };
  /** The role's criteria per dimension (round 2): the rows a criteria matrix / head-to-head aligns on. */
  criteria: Record<CohortDimension, DimensionCriterion[]>;
  /** The role's salary band, so the salary layer can draw it; null when the job has none. */
  roleBand: RoleBand | null;
}

/** GET /api/analyze/cohort — the recent-cohorts strip. */
export interface CohortSummary {
  cohortId: string;
  jdSlug: string;
  jdTitle: string;
  status: CohortStatus;
  memberCount: number;
  leaderLabel: string | null;
  createdAt: string;
}

// ---- UI seams (the three worlds and the shared dimension pages) ------------------

/** Props every prototype world receives. Each world owns its L0 and its OWN descent. */
export interface CohortWorldProps {
  view: CohortView;
  /** Open the full single-candidate report (History deep link) for a member with an analysisSlug. */
  onOpenReport: (analysisSlug: string) => void;
}

/** Props of the shared dimension page a world descends into. */
export interface DimensionPageProps {
  view: CohortView;
  dimension: CohortDimension;
  /** The member the page highlights (the one the descent started from), or null. */
  focusMemberId: string | null;
  onFocusMember: (memberId: string | null) => void;
  onOpenReport: (analysisSlug: string) => void;
}

// ---- Engine inputs the server supplies -------------------------------------------

/** The role's salary band (jobs.salary_min/max + the payload's currency/period); every field nullable. */
export interface RoleBand {
  currency: string | null;
  period: string | null;
  min: number | null;
  max: number | null;
}

/**
 * What the role asks for, as the why-engine reads it (jobs.min_years, seniority, role_family
 * and the band above). Every field nullable: a value the ingest DEFAULTED (a phantom
 * "medior", an anchor band) is null here, never read as the role's own statement.
 */
export interface RoleContext {
  minYears: number | null;
  seniority: string | null;
  band: RoleBand | null;
  roleFamily: string | null;
}

/**
 * What the comparative pass (pipeline/jobfit/cohort_compare.py) returns, already filtered to
 * reorder-surviving claims. Merged into the view by assembleCohortView (cohortProject.ts).
 */
export interface CohortComments {
  cells: Array<{ memberId: string; dimension: CohortDimension; comment: string }>;
  notes: Partial<Record<CohortDimension, string>>;
  narrative: CohortNarrative | null;
}

// ---- Round 2: why a score sits where it does -------------------------------------
//
// Assembled DETERMINISTICALLY by cohortProject from fields every analysis already carries
// (score parts, matched / missing / unproven skills with reasons, seniority and role
// alignment, risk flags, must-prove evidence, salary assessment, soft signals, trust
// findings, GitHub evidence). Nothing here is newly written by a model; prose that DOES
// come from the analysis (an alignment sentence, a strength) is carried verbatim as
// `text` and is in the analysis's report language.

/** Code-made words as data (`key` under analyzeCohort.why.*) OR analysis prose verbatim. */
export type Phrase = ShortLabel | { text: string };
export const isTextPhrase = (p: Phrase): p is { text: string } => "text" in p;

export const REASON_TONES = ["pro", "con", "note"] as const;
export type ReasonTone = (typeof REASON_TONES)[number];

/** Which analysis field a reason came from — the evidence expand names it. */
export const REASON_SOURCES = [
  "scoreParts", "skills", "unproven", "alignment", "strengths", "gaps", "risk", "mustProve",
  "softSignal", "trust", "salary", "band", "github", "evidenceTrace",
] as const;
export type ReasonSource = (typeof REASON_SOURCES)[number];

export interface Reason {
  tone: ReasonTone;
  phrase: Phrase;
  source: ReasonSource;
  /**
   * Rating points, present ONLY when the rating is a code formula over parts (skills,
   * experience, signals, trust, salary, publicWork); fit is model-given and never carries them.
   * A PRO's or NOTE's points are what that part earned (it matches its anatomy term). A CON's
   * points are NEGATIVE and say what the part FAILED to earn against its full value (a missing
   * skill: -17 while its anatomy term is 0; "Experience 8/25": -35 while its term is +16).
   * So reason points do NOT sum to the rating — ScoreAnatomy is the exact source for sums.
   * Measured by all four round-2 layer builders; a `pointsKind: "term" | "forgone"` field is the
   * proposed fix for the consolidation round.
   */
  points?: number;
  /** Supporting lines from the analysis (verbatim), for the expand. Omitted when none. */
  evidence?: string[];
  /** The criterion this reason speaks to, when it maps onto one (DimensionCriterion.id). */
  criterionId?: string;
}

/** The exact decomposition of a formula-made rating. Omitted for fit (model-given) and absent cells. */
export interface ScoreAnatomy {
  /** Where the formula starts (e.g. signals start at 50); 0 when it starts at nothing. */
  base: number;
  parts: Array<{ phrase: Phrase; points: number; tone: ReasonTone }>;
  /** base + sum(parts) before clamping, and the rating after — they differ only when clamped. */
  raw: number;
  rating: number;
}

export const CRITERION_STATUSES = ["meets", "partial", "misses", "unknown"] as const;
export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

/** One row a matrix / head-to-head aligns on: a required skill, the seniority target, the band, a trust check… */
export interface DimensionCriterion {
  /** Stable within the cohort and dimension, e.g. "skill:kafka", "seniority", "band", "trust:EMPLOYMENT_OVERLAP". */
  id: string;
  phrase: Phrase;
  /** must = a requirement of the role; signal = observed across members (a soft signal, a finding). */
  kind: "must" | "nice" | "target" | "signal";
}

export interface MemberDimensionWhy {
  /** One short code-made sentence: why the rating is at this level (e.g. "7 of 9 required skills; Oracle missing"). */
  why: Phrase;
  pros: Reason[];
  cons: Reason[];
  /** Neutral context (an unproven claim, a probe to ask) — neither earns nor costs. */
  notes: Reason[];
  anatomy?: ScoreAnatomy;
  /** Status per DimensionCriterion.id of this dimension (every criterion has an entry; unknown when not read). */
  criteria: Record<string, { status: CriterionStatus; note?: Phrase }>;
}

// ---- Round 2: the nested-layer prototypes ----------------------------------------

/** `pages` = the round-1 dimension pages (baseline); the four structures are under judgement. */
export const COHORT_LAYERS = ["pages", "ledger", "anatomy", "headToHead", "matrix"] as const;
export type CohortLayer = (typeof COHORT_LAYERS)[number];
export const isCohortLayer = (v: unknown): v is CohortLayer =>
  typeof v === "string" && (COHORT_LAYERS as readonly string[]).includes(v);

/** Props of every nested-layer structure: the same seam as DimensionPage. */
export type DimensionLayerProps = DimensionPageProps;

