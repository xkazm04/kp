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
  /** The amount in US dollars at the rate valid when the scan filed it (every non-USD
   *  currency, EUR included so the file can sort across currencies; the UI SHOWS it for
   *  currencies other than USD and EUR). Absent = not converted (USD itself, no amount, an
   *  unknown currency, or no rate at scan time). USD-pegged stablecoins (USDC, USDT) at 1. */
  usd?: GigRewardUsd | null;
};

/** One conversion, kept with its provenance so the estimate is never mistaken for the
 *  listing's own figure. */
export type GigRewardUsd = { amount: number; rate: number; rateAt: string; source: string };

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
    /** The listing's tags AND its text name physical work (qualify.ts nonDigitalWork). Absent
     *  on a verdict written before the rule existed (2026-09-30). */
    notDigitalWork?: boolean;
  };
  note: string | null;
  source: "deterministic" | "llm";
  fallbackReason: string | null;
  /** Why the pipeline itself declined the gig; absent / null = it did not. `declinedBy`
   *  says which layer: the qualification rule or the research brief's work kind. */
  declineReason?: GigDeclineReason | null;
  declinedBy?: "rule" | "model" | null;
  /** What the rule matched (tags and phrases), for the operator to check it. */
  declineEvidence?: string[];
};

/** The reasons the PIPELINE declines a gig on its own (the operator's own decline carries
 *  none). `not_digital_work`: goods, sourcing or supplying physical items, on-site work,
 *  shipping or hardware - nothing an AI agent at a computer can deliver. */
export const GIG_DECLINE_REASONS = ["not_digital_work"] as const;
export type GigDeclineReason = (typeof GIG_DECLINE_REASONS)[number];

/** Why the pipeline declined this gig, and which layer did: the qualification rule
 *  (qualification.declineReason) or the research brief (a `physical` work kind on a
 *  declined gig). Null when the gig is not declined, or the operator declined it. Pure, and
 *  import-free so a client surface can read it. */
export function gigPipelineDecline(
  gig: Pick<Gig, "status" | "qualification" | "brief">
): { reason: GigDeclineReason; by: "rule" | "model"; evidence: string[]; detail: string | null } | null {
  if (gig.status !== "declined") return null;
  const q = gig.qualification;
  if (q?.declineReason === "not_digital_work") {
    const by = q.declinedBy === "model" ? "model" : "rule";
    return { reason: "not_digital_work", by, evidence: q.declineEvidence ?? [], detail: by === "model" ? (gig.brief?.workKindReason ?? null) : null };
  }
  if (gig.brief?.workKind === "physical") return { reason: "not_digital_work", by: "model", evidence: [], detail: gig.brief.workKindReason ?? null };
  return null;
}

// ---------------------------------------------------------------------------
// Research: the links a listing names, read once, and the readable brief
// (app/_lib/gigs/research.ts, docs/features/gigs/README.md "Research")
// ---------------------------------------------------------------------------

/** How hard the work looks. `unrated` is the honest answer when no model rated it. */
export const GIG_DIFFICULTIES = ["easy", "moderate", "hard", "very_hard", "unrated"] as const;
export type GigDifficulty = (typeof GIG_DIFFICULTIES)[number];
export function isGigDifficulty(v: unknown): v is GigDifficulty {
  return typeof v === "string" && (GIG_DIFFICULTIES as readonly string[]).includes(v);
}

/** What happened to one link the listing named. `fetched` = read (a page that tripped
 *  the honeypot scan says so in `reason`, `suspect:<reasons>`); `blocked` = refused by
 *  kp's egress guard (private/loopback host) or by the host itself (robots.txt, a
 *  denial); `skipped` = deliberately not read (offline, the gig is suspect, a type kp
 *  cannot read as text, the budget ran out); `failed` = tried and could not read. */
export const GIG_LINK_STATUSES = ["fetched", "skipped", "blocked", "failed"] as const;
export type GigBriefLinkStatus = (typeof GIG_LINK_STATUSES)[number];
export type GigBriefLink = { url: string; title: string | null; status: (typeof GIG_LINK_STATUSES)[number]; reason: string | null; chars: number | null };

export type GigBriefSection = { id: string; level: 2 | 3; text: string };

export type GigBrief = {
  version: 1;
  /** High-level category, e.g. "Web security · Stored XSS", "ML · Tabular forecasting". */
  category: string;
  /** The listing retitled with its category up front, e.g. "Web security · Stored XSS in profile bio". */
  title: string;
  difficulty: GigDifficulty;
  /** Why that difficulty, one sentence; null when unrated. */
  difficultyReason: string | null;
  effort: { minHours: number; maxHours: number; note: string | null } | null;
  challenges: string[];
  /** The readable brief, Markdown (the subset app/_components/Markdown.tsx renders). */
  markdown: string;
  /** Headings parsed ONCE when the brief is written (registry: server-parsed-once-reused), ids minted by ONE assigner. */
  sections: GigBriefSection[];
  links: GigBriefLink[];
  source: "llm" | "deterministic";
  fallbackReason: string | null;
  promptVersion: string;
  createdAt: string;
  // Added by prompt gig-brief-v4 (gig-mastery adjustments 2026-09-30). All optional: a
  // brief written before v4 has none of them, and each absent key reads as "not known".
  /** The listing's language, ISO 639-1 ("en", "cs", "de"...). */
  language?: string | null;
  /** The listing translated to English when `language` is not "en"; null when it is English. */
  listingEnglish?: string | null;
  /** Work the operator must ask the client for before starting (credentials, files, specs,
   *  sample data...) that the listing does not provide. */
  missingArtifacts?: string[];
  /** A ready-to-send first message to the client (freelance gigs): interest, one line on the
   *  approach, and the missing artifacts asked for. Plain text, English. */
  outreachMessage?: string | null;
  /** Whether an AI agent working on a computer can deliver the work: `physical` (goods,
   *  on-site work, shipping, sourcing physical items) is declined by the pipeline. */
  workKind?: GigWorkKind | null;
  workKindReason?: string | null;
};

export const GIG_WORK_KINDS = ["digital", "mixed", "physical"] as const;
export type GigWorkKind = (typeof GIG_WORK_KINDS)[number];

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
  /** The research brief (links read + the readable Markdown); null until researched. */
  brief: GigBrief | null;
  /** The gig's own folder on disk (gigs/workdir.ts): absolute, under the gigs root.
   *  Null until its workspace is first prepared. */
  workdir: string | null;
  /** The Personas project rooted at `workdir` (gigs/project.ts); null until Personas
   *  registered it (unpaired, unreachable, or a build without the project route). */
  personasProjectId: string | null;
  /** The brief challenge the operator withdrew this gig for (withdraw-reasons.ts); null
   *  when it is not withdrawn, or was withdrawn without naming one. */
  withdrawReason: GigWithdrawReason | null;
  createdAt: string;
  updatedAt: string;
};

/** One of the gig's brief challenges, copied from the brief when the operator withdrew the
 *  gig for it: the text as the brief said it, its bullet's index, and when. */
export type GigWithdrawReason = { challenge: string; index: number; at: string };

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
  /** The ONE gig this persona was hired for (one persona per gig, gig-mastery S2); null on
   *  the niche specialists hired before, which serve many gigs and are retired as their
   *  open work closes. */
  gigId: string | null;
  name: string;
  spec: GigSpecialistSpec;
  /** Whether the recipe content came from the registry checkout or the built-in seed map. */
  registry: "available" | "unavailable";
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// Plans: three models propose, the operator accepts exactly one (gig-mastery S1)
// ---------------------------------------------------------------------------

/** The seats that write plan proposals; the lineup itself is plan-seats.ts. */
export const GIG_PLAN_SEAT_IDS = ["fable", "opus", "sonnet", "gpt"] as const;
export type GigPlanSeatId = (typeof GIG_PLAN_SEAT_IDS)[number];

export function isGigPlanSeatId(v: unknown): v is GigPlanSeatId {
  return typeof v === "string" && (GIG_PLAN_SEAT_IDS as readonly string[]).includes(v);
}

export const GIG_PLAN_STATUSES = ["queued", "running", "ready", "failed"] as const;
export type GigPlanStatus = (typeof GIG_PLAN_STATUSES)[number];
export function isGigPlanStatus(v: unknown): v is GigPlanStatus {
  return typeof v === "string" && (GIG_PLAN_STATUSES as readonly string[]).includes(v);
}

/** One step of a plan; it becomes one goal of the gig's Personas milestone. */
export type GigPlanStep = { title: string; doneWhen: string };

/** A plan as one model wrote it (gig_plan_cli.py, prompt gig-plan-v1). The decisions and
 *  risks are required reading at the gate (registry: plan-review): what the plan decided
 *  without saying so is the part a person cannot reconstruct from the steps. */
export type GigPlan = {
  summary: string;
  /** 4-9 steps. */
  steps: GigPlanStep[];
  decisions: string[];
  risks: string[];
  effortHours: { min: number; max: number } | null;
  questions: string[];
};

/** A goal's state as the agent reports it in PLAN-STATUS.json and kp mirrors to Personas. */
export const GIG_GOAL_STATUSES = ["open", "in-progress", "blocked", "done"] as const;
export type GigGoalStatus = (typeof GIG_GOAL_STATUSES)[number];
export type GigGoalProgress = { stepIndex: number; goalId: string | null; status: GigGoalStatus; progress: number; note: string | null };

/** Where the accepted plan stands as a Personas milestone: written by the pairing (the
 *  milestone and goal ids) and by the sync (each goal's reported status). */
export type GigPlanProgress = { milestoneId: string | null; goals: GigGoalProgress[]; updatedAt: string };

/** One seat's proposal for one gig, as the store holds it. `plan` is null until the seat is
 *  `ready`; `costUsd` null = not reported (never 0). */
export type GigPlanRow = {
  id: string;
  gigId: string;
  seat: GigPlanSeatId;
  model: string;
  effort: string | null;
  status: GigPlanStatus;
  plan: GigPlan | null;
  fallbackReason: string | null;
  costUsd: number | null;
  durationMs: number | null;
  /** The operator's note at acceptance; rides into the assignment. */
  note: string | null;
  acceptedAt: string | null;
  progress: GigPlanProgress | null;
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
  /** The run's spend cap in USD; null = uncapped (a gig persona, plan-seats.ts). */
  budgetUsd: number | null;
  deliverableContract: typeof GIG_DELIVERABLE_CONTRACT;
  /** The gig's own folder (gigs/workdir.ts), absolute. The run's working directory when
   *  `_projectId` is present; otherwise where the gig's files are, for reference. Absent
   *  when the folder could not be prepared. */
  workdir?: string;
  /** The Personas project rooted at `workdir`. Personas reads `input_data._projectId`
   *  (a top-level string) and binds the run's cwd to that project's root. Absent when the
   *  Personas build has no project route (`personas_route_missing`), so the run executes
   *  where Personas always ran it. */
  _projectId?: string;
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
