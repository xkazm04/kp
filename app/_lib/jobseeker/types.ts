// Job-seeker module — the ONE wire vocabulary every package shares.
//
// This file is the contract the spark's work packages build against in parallel:
// stores, routes, the /me pages, the Python bridge and the scheduler job all import
// these names and never redeclare them. A field added here is a field every consumer
// sees; a field declared anywhere else is the drift this file exists to prevent.
//
// Pure types + closed vocabularies + their runtime guards (the tabs.ts / locales.ts
// pattern): literal array → derived union → `isX()` guard. No imports from stores,
// no React, no Node built-ins — the browser bundle and `node --test` both load it.

import type { ProfilePayload } from "@/app/features/shared/profileTypes";

// ---------------------------------------------------------------------------
// Preferences (what the CV studio extracts and the engine reads)
// ---------------------------------------------------------------------------

export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export type WorkMode = (typeof WORK_MODES)[number];
export function isWorkMode(v: unknown): v is WorkMode {
  return typeof v === "string" && (WORK_MODES as readonly string[]).includes(v);
}

export const SENIORITIES = ["junior", "medior", "senior", "lead"] as const;
export type Seniority = (typeof SENIORITIES)[number];
export function isSeniority(v: unknown): v is Seniority {
  return typeof v === "string" && (SENIORITIES as readonly string[]).includes(v);
}

export const SALARY_PERIODS = ["month", "year"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

/** A pay figure carries its own currency; there is NO conversion anywhere in the
 *  module (salary-band.ts contract): a comparison happens only when both sides share
 *  a currency, otherwise the answer is "not comparable", never a converted number. */
export type SalaryFloor = { amount: number; currency: string; period: SalaryPeriod };

export type DeepDivePolicy = {
  /** Postings scoring at or above this total are eligible for the LLM deep-dive. */
  threshold: number;
  /** Hard cap on deep-dives per scan; LLM spend scales with the shortlist, not the market. */
  maxPerScan: number;
};

export const DEFAULT_DEEP_DIVE: DeepDivePolicy = { threshold: 65, maxPerScan: 10 };

export type JobseekerPreferences = {
  /** Free-text places the seeker would work ("Praha", "Brno"), matched softly. */
  locations: string[];
  /** ISO-3166-1 alpha-2, lower-case ("cz", "de"): the markets the EURES adapter queries. */
  countries: string[];
  workModes: WorkMode[];
  salaryFloor: SalaryFloor | null;
  targetRoleFamilies: string[];
  targetTitles: string[];
  languages: string[];
  seniority: Seniority | null;
  deepDive: DeepDivePolicy;
};

export const EMPTY_PREFERENCES: JobseekerPreferences = {
  locations: [],
  countries: [],
  workModes: [],
  salaryFloor: null,
  targetRoleFamilies: [],
  targetTitles: [],
  languages: [],
  seniority: null,
  deepDive: DEFAULT_DEEP_DIVE,
};

// ---------------------------------------------------------------------------
// Profile (one row per workspace + user: the seeker's OWN record)
// ---------------------------------------------------------------------------

export type JobseekerProfile = {
  id: string;
  /** The recruiter-side CandidateProfileV2 shape, reused verbatim (profile_draft output). */
  profile: ProfilePayload;
  preferences: JobseekerPreferences;
  /** Raw text extracted from the uploaded CV (extract-text), the polish dialog's source. */
  cvSourceText: string | null;
  /** The polished CV as Markdown; null until the studio produced one. */
  cvPolishedMd: string | null;
  cvHash: string | null;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Sources (owner-confirmed acquisition; tiers decide the confirmation door)
// ---------------------------------------------------------------------------

/** A = rights-clean feeds (plain toggle). B = boards that robots.txt permits but whose
 *  terms forbid automated processing — enabling requires the owner's acknowledgement.
 *  C = boards that block or forbid outright — listed as refused, never fetched. */
export const SOURCE_TIERS = ["A", "B", "C"] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];

export const SOURCE_KINDS = ["feed", "ats", "board"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_ADAPTERS = [
  "eures",
  "mpsv_bulk",
  "ats_greenhouse",
  "ats_lever",
  "ats_recruitee",
  "ats_teamtailor",
  "ats_personio",
  "ats_workable",
  "ats_ashby",
  "ats_smartrecruiters",
  "board_sitemap_jsonld",
  "board_rules",
] as const;
export type SourceAdapterName = (typeof SOURCE_ADAPTERS)[number];
export function isSourceAdapterName(v: unknown): v is SourceAdapterName {
  return typeof v === "string" && (SOURCE_ADAPTERS as readonly string[]).includes(v);
}

/** Why a source is not running. `blocked` is set by the fetcher (denial status or
 *  interstitial) and is NEVER cleared by a scan — only the owner resumes it. */
export const PAUSE_REASONS = ["blocked", "collapsed", "owner", "terms_review"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

/** Outcome of one source within one scan run (the scrape-scheduling vocabulary:
 *  zero-rows-success is `collapsed`, a denial is `blocked`, neither is `succeeded`). */
export const SOURCE_RUN_OUTCOMES = ["succeeded", "collapsed", "blocked", "offline", "failed", "skipped"] as const;
export type SourceRunOutcome = (typeof SOURCE_RUN_OUTCOMES)[number];

export type JobseekerSource = {
  id: string;
  kind: SourceKind;
  adapter: SourceAdapterName;
  tier: SourceTier;
  /** Host the adapter talks to (politeness state is keyed by host). */
  host: string;
  /** Adapter-specific config: board token, company slug, sitemap URL, EURES countries… */
  config: Record<string, unknown>;
  enabled: boolean;
  acknowledgedAt: string | null;
  /** Hash of the terms summary the owner acknowledged, so a changed clause re-asks. */
  acknowledgedTermsHash: string | null;
  pausedReason: PauseReason | null;
  pausedAt: string | null;
  /** Extraction rules (board_rules adapter only); persisted only after a dry-run preview. */
  rules: ExtractionRule[] | null;
  /** Per-rule expected match counts seeded by the preview (collapse detection baseline). */
  rulesBaseline: Record<string, number> | null;
  lastRunAt: string | null;
  lastOutcome: SourceRunOutcome | null;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Extraction rules DSL (board_rules adapter; model-as-author, engine-as-extractor)
// ---------------------------------------------------------------------------

export const RULE_FIELDS = ["title", "company", "location", "url", "postedAt", "salaryText", "externalKey"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export const LOCATOR_KINDS = ["css", "regex", "jsonld", "pointer"] as const;
export type LocatorKind = (typeof LOCATOR_KINDS)[number];

export const RULE_POST_OPS = ["trim", "text", "absUrl", "number", "date"] as const;
export type RulePostOp = (typeof RULE_POST_OPS)[number];

export type ExtractionRule = {
  field: RuleField;
  locator: { kind: LocatorKind; expr: string; attr?: string };
  cardinality: "one" | "many";
  /** Which match wins when `cardinality: "one"` matched several; `fail` = ambiguous is a miss. */
  pick: "first" | "last" | "fail";
  post: RulePostOp[];
  /** A required rule missing across a whole page is a SHAPE condition (collapse), not data. */
  required: boolean;
};

export type RuleVerdict = "hit" | "miss-required" | "miss-optional" | "ambiguous";

export type RuleDryRunResult = {
  field: RuleField;
  matched: number;
  samples: string[];
  verdict: RuleVerdict;
};

// ---------------------------------------------------------------------------
// Postings (the reconciled dataset, one row per real-world posting per source)
// ---------------------------------------------------------------------------

export const POSTING_STATUSES = ["new", "shortlisted", "applied", "dismissed", "gone"] as const;
export type PostingStatus = (typeof POSTING_STATUSES)[number];
export function isPostingStatus(v: unknown): v is PostingStatus {
  return typeof v === "string" && (POSTING_STATUSES as readonly string[]).includes(v);
}

export const DISMISS_REASONS = ["salary", "location", "stack", "seniority", "company", "other"] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];
export function isDismissReason(v: unknown): v is DismissReason {
  return typeof v === "string" && (DISMISS_REASONS as readonly string[]).includes(v);
}

export const FIT_TIERS = ["strong", "promising", "partial"] as const;
export type FitTier = (typeof FIT_TIERS)[number];

/** What an adapter hands to reconciliation: the raw posting as the source published it. */
export type RawPosting = {
  /** The source's own identifier when it has one; else the canonical URL. */
  externalKey: string;
  url: string;
  title: string;
  company: string | null;
  location: string | null;
  country: string | null;
  workMode: WorkMode | null;
  postedAt: string | null;
  salaryText: string | null;
  /** Parsed by the adapter/structurer (JSON-LD baseSalary or a salary regex) so the
   *  store never guesses; null = the posting did not state pay (unknown, never "under"). */
  salary: { min: number | null; max: number | null; currency: string; period: SalaryPeriod } | null;
  bodyText: string;
  /** The schema.org JobPosting object when the page carried one. */
  jsonld: Record<string, unknown> | null;
  lang: string | null;
};

export type EligibilityKey = "salary" | "location" | "seniority" | "language" | "work_mode";
/** `flag` = a measured mismatch; `unknown` = the posting did not say (never a penalty). */
export type EligibilityFlag = { key: EligibilityKey; state: "ok" | "flag" | "unknown"; detail: string };

export type JobseekerPosting = {
  id: string;
  sourceId: string;
  externalKey: string;
  url: string;
  title: string;
  company: string | null;
  location: string | null;
  country: string | null;
  workMode: WorkMode | null;
  postedAt: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  bodyText: string;
  jsonld: Record<string, unknown> | null;
  contentHash: string;
  /** The structured `Job` the matcher scored (pipeline Job model, camelCased by codegen). */
  job: Record<string, unknown> | null;
  jobSource: "deterministic" | "llm" | null;
  /** The MatchResult verbatim (pipeline schema); the columns below are its indexed projection. */
  match: Record<string, unknown> | null;
  matchTotal: number | null;
  fitTier: FitTier | null;
  matchVersion: string | null;
  matchedAt: string | null;
  /** match_reasoning output when deep-dived. */
  reasoning: Record<string, unknown> | null;
  status: PostingStatus;
  dismissReason: DismissReason | null;
  dismissNote: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  goneAt: string | null;
};

/** The feed projection: no body, no raw JSON-LD, no full match payload — a list of 200
 *  postings must not ship 200 advertisements to the browser. */
export type JobseekerPostingSummary = Omit<JobseekerPosting, "bodyText" | "jsonld" | "job" | "match" | "reasoning" | "contentHash"> & {
  bodyChars: number;
  eligibility: EligibilityFlag[];
  confidence: { low: number; high: number; level: "tight" | "moderate" | "wide" } | null;
  deepDived: boolean;
};

// ---------------------------------------------------------------------------
// Dialogs (the Studio kit's two seeker variants)
// ---------------------------------------------------------------------------

export const DIALOG_KINDS = ["cv_polish", "fit"] as const;
export type DialogKind = (typeof DIALOG_KINDS)[number];
export function isDialogKind(v: unknown): v is DialogKind {
  return typeof v === "string" && (DIALOG_KINDS as readonly string[]).includes(v);
}

export type DialogStatus = "open" | "closed";

export type CvPolishArtifact = {
  cvMarkdown: string;
  /** Preferences the dialog extracted so far; merged into the profile on close. */
  preferences: Partial<JobseekerPreferences>;
  /** Blocks of the source CV the pipeline could not read — shown, never scored as absence. */
  unreadable: string[];
  suggestions: { section: string; before: string; after: string; why: string }[];
};

export type FitArtifact = {
  verdict: "apply" | "skip" | "undecided";
  gaps: { skill: string; severity: "blocking" | "notable" | "minor"; mitigation: string }[];
  coverNoteMd: string | null;
  questionsToAsk: string[];
};

export type DialogArtifact = CvPolishArtifact | FitArtifact;

export type JobseekerDialog = {
  id: string;
  profileId: string;
  kind: DialogKind;
  postingId: string | null;
  transcript: StudioTurn[];
  artifact: DialogArtifact | null;
  status: DialogStatus;
  lang: string;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Studio wire (shared with the recruiter intake through app/_components/studio)
// ---------------------------------------------------------------------------

export type StudioTurnRole = "interviewer" | "candidate" | "system";

export type StudioChoiceOption = { id: string; label: string; detail?: string };
export type StudioChoiceSet = {
  kind: "confirm" | "propose";
  field: string;
  prompt: string;
  multi: boolean;
  options: StudioChoiceOption[];
};

export type StudioTurn = {
  role: StudioTurnRole;
  text: string;
  choices?: StudioChoiceSet | null;
  at?: string;
};

export type StudioReplySource = "llm" | "deterministic";

export type StudioReply = {
  reply: string;
  done: boolean;
  source: StudioReplySource;
  choices?: StudioChoiceSet | null;
  fallbackReason?: string | null;
  fallbackLang?: string | null;
};

export type DialogReply = StudioReply & { artifact: DialogArtifact | null };

// ---------------------------------------------------------------------------
// Scan (the scheduler job and the manual run share this summary)
// ---------------------------------------------------------------------------

export const SCAN_JOB_NAME = "jobseeker_scan";
export const SCAN_TASK_KIND = "jobseeker_scan";

export type SourceRunSummary = {
  sourceId: string;
  outcome: SourceRunOutcome;
  new: number;
  changed: number;
  unchanged: number;
  absent: number;
  /** Why `failed`/`blocked`/`collapsed` — a closed-vocabulary code, never a message. */
  reason: string | null;
};

export type ScanSummary = {
  workspaceId: string;
  trigger: "clock" | "manual";
  startedAt: string;
  finishedAt: string;
  sources: SourceRunSummary[];
  matched: number;
  deepDived: number;
  /** `no_provider` when the deep-dive was skipped keyless. */
  deepDiveSkipped: string | null;
};
