// The Gigs wire vocabulary - ONE file, imported by every layer (stores, adapters,
// dispatch, routes, the Gig desk UI). Nothing redeclares it.
//
// A gig is one unit of real paid work found in the world - a security program, a
// freelance brief, an ML competition, an open-source bounty - that a specialist agent
// (composed from registry recipes, running in Personas) drafts and the OPERATOR reviews
// and sends under their own account. Nothing here ever submits to a marketplace or a
// program on its own: the operator is the only actor that sends (docs/features/gigs).
//
// Design record: Spark vault idea `agent-foundry-validation` (2026-09-24).
//
// Absent-value convention, stated once: an unknown value is `null`, never `0` or `""`.
// A reward we could not read is not a reward of zero, and a deadline we did not see is
// not "no deadline".

// ---------------------------------------------------------------------------
// Arenas and sources
// ---------------------------------------------------------------------------

/** The four kinds of paid work v1 covers. Arena is data, not a code path. */
export const GIG_ARENAS = ["security", "freelance", "competition", "oss_bounty"] as const;
export type GigArena = (typeof GIG_ARENAS)[number];
export function isGigArena(v: unknown): v is GigArena {
  return typeof v === "string" && (GIG_ARENAS as readonly string[]).includes(v);
}

/** Official APIs only; `manual` is the operator forwarding a brief. A site whose terms
 *  forbid automated access is never given an adapter here - it stays `manual`. */
export const GIG_ADAPTERS = [
  "manual",
  "github_bounty",
  "algora",
  "kaggle",
  "hackerone",
  "freelancer_api",
  "upwork_api",
] as const;
export type GigAdapterName = (typeof GIG_ADAPTERS)[number];
export function isGigAdapterName(v: unknown): v is GigAdapterName {
  return typeof v === "string" && (GIG_ADAPTERS as readonly string[]).includes(v);
}

/** The arena each adapter's listings belong to (a source never mixes arenas). */
export const GIG_ADAPTER_ARENA: Readonly<Record<GigAdapterName, GigArena | null>> = {
  manual: null, // the operator names the arena when forwarding
  github_bounty: "oss_bounty",
  algora: "oss_bounty",
  kaggle: "competition",
  hackerone: "security",
  freelancer_api: "freelance",
  upwork_api: "freelance",
};

/** Same semantics as the job-seeker tiers (app/_lib/jobseeker/types.ts SOURCE_TIERS):
 *  A = rights-clean API (plain toggle); B = allowed by an official API whose terms
 *  bind the operator's account - enabling requires the operator's acknowledgement of
 *  the terms, recorded with a hash so a changed clause re-asks; C = refused, never
 *  fetched. */
export const GIG_SOURCE_TIERS = ["A", "B", "C"] as const;
export type GigSourceTier = (typeof GIG_SOURCE_TIERS)[number];

export const GIG_ADAPTER_TIER: Readonly<Record<GigAdapterName, GigSourceTier>> = {
  manual: "A",
  github_bounty: "A",
  algora: "A",
  kaggle: "B",
  hackerone: "B",
  freelancer_api: "B",
  upwork_api: "B",
};

/** Why a source is not running. `blocked` (a denial from the host) and `invalid_streak`
 *  (too many rejected outcomes in a row - programs suspend accounts for that) are
 *  lifted only by the operator; a scan never un-pauses. */
export const GIG_PAUSE_REASONS = ["blocked", "collapsed", "owner", "terms_review", "invalid_streak", "no_key"] as const;
export type GigPauseReason = (typeof GIG_PAUSE_REASONS)[number];
export function isGigPauseReason(v: unknown): v is GigPauseReason {
  return typeof v === "string" && (GIG_PAUSE_REASONS as readonly string[]).includes(v);
}

/** The task kind the Gig desk's "scan now" enqueues (app/_lib/task-kinds.ts) - also the
 *  scheduler job name it verifies (scheduler-jobs.ts). */
export const GIG_SCAN_TASK_KIND = "gig_scan";

/** Consecutive rejected/duplicate outcomes on one source that auto-pause it. */
export const GIG_INVALID_STREAK_LIMIT = 5;

export const GIG_SOURCE_RUN_OUTCOMES = ["succeeded", "collapsed", "blocked", "offline", "failed", "skipped"] as const;
export type GigSourceRunOutcome = (typeof GIG_SOURCE_RUN_OUTCOMES)[number];

export type GigSource = {
  id: string;
  adapter: GigAdapterName;
  arena: GigArena;
  tier: GigSourceTier;
  host: string;
  /** Adapter-specific config: search query, labels, program handle filter... never a secret. */
  config: Record<string, unknown>;
  enabled: boolean;
  acknowledgedAt: string | null;
  acknowledgedTermsHash: string | null;
  pausedReason: GigPauseReason | null;
  pausedAt: string | null;
  /** Consecutive rejected/duplicate outcomes; reset by an accepted one. */
  invalidStreak: number;
  lastRunAt: string | null;
  lastOutcome: GigSourceRunOutcome | null;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Gigs
// ---------------------------------------------------------------------------

export const GIG_STATUSES = [
  "new",
  "suspect",
  "qualified",
  "declined",
  "dispatched",
  "drafted",
  "in_review",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "withdrawn",
] as const;
export type GigStatus = (typeof GIG_STATUSES)[number];
export function isGigStatus(v: unknown): v is GigStatus {
  return typeof v === "string" && (GIG_STATUSES as readonly string[]).includes(v);
}

/** Why the deterministic honeypot scan held a gig back from dispatch. Gig text is
 *  UNTRUSTED input written by strangers, and a large share of public bounty listings
 *  carry instructions aimed at agents (paste your system prompt, send credentials). */
export const GIG_SUSPECT_REASONS = [
  "hidden_instructions",
  "prompt_exfiltration",
  "credential_request",
  "off_platform_payment",
  "agent_addressed",
] as const;
export type GigSuspectReason = (typeof GIG_SUSPECT_REASONS)[number];
export function isGigSuspectReason(v: unknown): v is GigSuspectReason {
  return typeof v === "string" && (GIG_SUSPECT_REASONS as readonly string[]).includes(v);
}

export type GigReward = {
  /** Null when the listing stated no parseable amount. */
  amount: number | null;
  /** ISO 4217 or a token symbol as the source printed it; null when unknown. */
  currency: string | null;
  /** The reward exactly as the listing stated it. */
  text: string;
};

/** What an adapter hands to the scan: the listing as the source published it. */
export type RawGig = {
  externalKey: string;
  url: string;
  title: string;
  /** The program, client, competition host or repository owner. */
  org: string | null;
  reward: GigReward | null;
  deadlineAt: string | null;
  postedAt: string | null;
  /** Plain text of the brief. UNTRUSTED. */
  bodyText: string;
  /** Raw HTML when the source served it, kept only for the honeypot scan. */
  bodyHtml: string | null;
  /** Niche tags as the source gave them (languages, techniques, dataset kind). */
  tags: string[];
};

/** The deterministic qualification verdict (an optional LLM note rides beside it). */
export type GigQualification = {
  /** 0..100; deterministic arithmetic over the factors, never an LLM number. */
  score: number;
  factors: {
    arenaFit: boolean;
    rewardKnown: boolean;
    /** Days until the deadline; null when no deadline was stated. */
    deadlineHeadroomDays: number | null;
    specialistAvailable: boolean;
    suspect: boolean;
  };
  note: string | null;
  source: "deterministic" | "llm";
  fallbackReason: string | null;
};

export type Gig = {
  id: string;
  /** Null for a `manual` gig the operator forwarded. */
  sourceId: string | null;
  arena: GigArena;
  externalKey: string;
  url: string;
  title: string;
  org: string | null;
  reward: GigReward | null;
  deadlineAt: string | null;
  postedAt: string | null;
  bodyText: string;
  tags: string[];
  niche: string | null;
  status: GigStatus;
  suspectReasons: GigSuspectReason[];
  /** The gig_specialists row matched to this gig; null until matched. */
  specialistId: string | null;
  qualification: GigQualification | null;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Specialists
// ---------------------------------------------------------------------------

/** A registry recipe pinned at the version the specialist adopted. */
export type RecipeRef = { slug: string; version: string };

export type GigExemplar = {
  title: string;
  url: string;
  arena: GigArena;
  /** One sentence: what this accepted piece of work shows the specialist. */
  why: string;
};

/** What makes an agent a specialist: its adopted recipes (the craft), a few real
 *  accepted exemplars, the taxonomy family it works in, and its budget per attempt. */
export type GigSpecialistSpec = {
  arena: GigArena;
  /** Free niche label within the arena ("web-app auth", "tabular", "rust cli"). */
  niche: string;
  /** One of the 16 taxonomy role families (pipeline/jobfit/taxonomy.py). */
  taxonomyFamily: string;
  recipes: RecipeRef[];
  exemplars: GigExemplar[];
  /** Connector CATEGORIES the persona needs (github, browser, research...). */
  connectors: string[];
  budgetUsdPerAttempt: number;
  promptVersion: string;
};

export type GigSpecialist = {
  id: string;
  /** The hired_agents roster row that carries the Personas persona. */
  hiredAgentId: string;
  name: string;
  spec: GigSpecialistSpec;
  /** Whether the recipe content came from the registry checkout or the built-in seed map. */
  registry: "available" | "unavailable";
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Attempts (one specialist run on one gig) and the deliverable contract
// ---------------------------------------------------------------------------

export const GIG_ATTEMPT_STATUSES = [
  "dispatched",
  "running",
  "drafted",
  "failed",
  "revision_requested",
  "approved",
  "sent",
  "discarded",
] as const;
export type GigAttemptStatus = (typeof GIG_ATTEMPT_STATUSES)[number];
export function isGigAttemptStatus(v: unknown): v is GigAttemptStatus {
  return typeof v === "string" && (GIG_ATTEMPT_STATUSES as readonly string[]).includes(v);
}

/** The versioned output contract a specialist must end its run with. Echoed in every
 *  assignment so a persona prompt and kp cannot drift silently. */
export const GIG_DELIVERABLE_CONTRACT = "kp-deliverable.v1" as const;
/** The fence tag the parser looks for; the LAST such block in the output wins. */
export const GIG_DELIVERABLE_FENCE = "kp-deliverable" as const;

/** The input kp hands Personas `POST /api/execute/{personaId}` as `input_data`. */
export type GigAssignment = {
  kind: "kp.gig.v1";
  gigId: string;
  attemptId: string;
  arena: GigArena;
  title: string;
  url: string;
  /** The listing text, UNTRUSTED. Carried as data, never concatenated into a prompt. */
  bodyUntrusted: string;
  reward: GigReward | null;
  deadlineAt: string | null;
  recipes: RecipeRef[];
  /** The checklist the operator will review against - the specialist sees it too. */
  checklist: string[];
  /** The operator's note when this attempt answers a revision request. */
  revisionNote: string | null;
  budgetUsd: number;
  deliverableContract: typeof GIG_DELIVERABLE_CONTRACT;
};

export const GIG_ARTIFACT_KINDS = ["text", "pr", "file", "submission", "report"] as const;
export type GigArtifactKind = (typeof GIG_ARTIFACT_KINDS)[number];

export const GIG_EVIDENCE_KINDS = ["test", "repro", "gate", "score", "source"] as const;
export type GigEvidenceKind = (typeof GIG_EVIDENCE_KINDS)[number];

export type GigDeliverable = {
  version: 1;
  summary: string;
  /** The text the operator would send (proposal, report, PR description, write-up). */
  draftText: string;
  artifacts: { kind: GigArtifactKind; ref: string; title: string }[];
  /** What the specialist actually ran. `passed: null` = ran, no pass/fail meaning. */
  evidence: { kind: GigEvidenceKind; command: string | null; result: string; passed: boolean | null }[];
  /** The AI-use disclosure sentence that goes out with the work. */
  disclosure: string;
  /** 0..1, the specialist's own; displayed, never used as a score. */
  confidence: number;
  /** Questions the specialist could not resolve; the operator answers via revise. */
  questions: string[];
};

export type GigReview = {
  /** Checklist item -> ticked. The disclosure item must be ticked to mark sent. */
  checklist: Record<string, boolean>;
  note: string | null;
  /** How long the operator spent on the card (anti-rubber-stamp signal). */
  reviewMs: number | null;
  reviewedAt: string;
};

export type GigAttempt = {
  id: string;
  gigId: string;
  specialistId: string;
  /** The Personas execution id; null until Personas accepted the dispatch. */
  executionId: string | null;
  status: GigAttemptStatus;
  deliverable: GigDeliverable | null;
  /** Why no deliverable exists when the run ended (`no_deliverable_block`, ...). */
  fallbackReason: string | null;
  /** Metered spend Personas reported for the run; null = not reported (not free). */
  costUsd: number | null;
  review: GigReview | null;
  revisionNote: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const GIG_REVIEW_ACTIONS = ["approve", "revise", "discard", "mark_sent"] as const;
export type GigReviewAction = (typeof GIG_REVIEW_ACTIONS)[number];
export function isGigReviewAction(v: unknown): v is GigReviewAction {
  return typeof v === "string" && (GIG_REVIEW_ACTIONS as readonly string[]).includes(v);
}

/** The checklist item every arena carries and `mark_sent` refuses without. */
export const GIG_DISCLOSURE_ITEM = "disclosure" as const;

// ---------------------------------------------------------------------------
// Outcomes (APPEND-ONLY - the external judge's verdict) and the KPI
// ---------------------------------------------------------------------------

export const GIG_OUTCOME_VERDICTS = ["accepted", "rejected", "duplicate", "no_response"] as const;
export type GigOutcomeVerdict = (typeof GIG_OUTCOME_VERDICTS)[number];
export function isGigOutcomeVerdict(v: unknown): v is GigOutcomeVerdict {
  return typeof v === "string" && (GIG_OUTCOME_VERDICTS as readonly string[]).includes(v);
}

export const GIG_OUTCOME_SOURCES = ["manual", "poller:github", "poller:kaggle"] as const;
export type GigOutcomeSource = (typeof GIG_OUTCOME_SOURCES)[number];

export type GigOutcome = {
  id: string;
  gigId: string;
  attemptId: string | null;
  verdict: GigOutcomeVerdict;
  /** Money actually awarded; null when none or unknown. Never summed across currencies. */
  amount: number | null;
  currency: string | null;
  /** The client's, maintainer's or program's words, verbatim. */
  feedbackText: string | null;
  source: GigOutcomeSource;
  recordedAt: string;
};

/** Below this many resolved outcomes a rate is shown with a small-sample flag. */
export const GIG_KPI_SMALL_SAMPLE = 10;

export type GigKpiCell = {
  /** Sent attempts with a recorded verdict. */
  resolved: number;
  accepted: number;
  /** accepted / resolved; null when resolved is 0 (unmeasured, never 0%). */
  rate: number | null;
  /** Sent attempts still waiting on the external judge - excluded from `rate`, shown. */
  pending: number;
  /** Metered spend / accepted; null when nothing was accepted or no cost was reported. */
  costPerAcceptedUsd: number | null;
  /** Attempts whose cost Personas never reported (the ledger's lower-bound honesty). */
  costUnreported: number;
  smallSample: boolean;
};

/** Money actually awarded in ONE currency. The list is never totalled across entries:
 *  a sum of USD and USDC is a number nobody was paid. */
export type GigKpiMoney = {
  /** As the verdict recorded it; null when the amount came with no currency. */
  currency: string | null;
  amount: number;
  /** Accepted outcomes that carried an amount in this currency. */
  count: number;
};

export type GigKpi = {
  byArena: Record<GigArena, GigKpiCell>;
  bySpecialist: Record<string, GigKpiCell>;
  /** Sent items whose disclosure was ticked / sent items; null when nothing was sent. */
  disclosureRate: number | null;
  /** Money won, one entry per currency, from each counted `accepted` verdict's amount.
   *  Sorted by currency; empty when nothing accepted carried an amount. */
  moneyWon: GigKpiMoney[];
  /** Counted `accepted` verdicts that recorded no amount (unknown, never zero). */
  acceptedWithoutAmount: number;
  computedAt: string;
};

// ---------------------------------------------------------------------------
// Lessons (what an outcome teaches the recipe that shaped the specialist)
// ---------------------------------------------------------------------------

/** One lesson line for a recipe's LESSONS.md, exported for the registry lander. */
export type GigLesson = {
  id: string;
  outcomeId: string;
  recipe: RecipeRef;
  arena: GigArena;
  verdict: GigOutcomeVerdict;
  /** Bullets, generalizable only: no account, credential, client name or path. */
  bullets: string[];
  landedAt: string | null;
  createdAt: string;
};
