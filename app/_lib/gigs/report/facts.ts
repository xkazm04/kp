import { lintDraft, type DraftLintFinding } from "../draft-lint";
import { GIG_TYPE_LABEL, gigTypeOf } from "../gig-type";
import { planSeatLabel } from "../plan-seats";
import { GIG_ARENA_LABEL } from "../specialist-defaults";
import {
  GIG_PROPOSAL_SPECIALIST_ID,
  gigTrackOf,
  type GigTrack,
} from "../types";
import type {
  Gig,
  GigAttempt,
  GigEvidenceKind,
  GigGoalStatus,
  GigOutcome,
  GigOutcomeVerdict,
  GigPlanRow,
  GigReportStage,
  GigSource,
  GigSourceState,
} from "../types";

// The report's FACTS: everything the report may say, read from kp's own records and
// assembled ONCE, with kp doing the arithmetic (the USD estimate, the rate per hour, the
// spend so far) so no model ever adds up a number. The same object is what the model reads
// (inside the untrusted fence - most of it is strangers' text or another model's reading of
// it) and what the deterministic body renders. Pure: rows in, facts out, the clock passed in.
//
// Absent-value convention (types.ts): unknown is null, never 0 or "". A cost no one
// reported is counted in `unreported`, never summed as zero.

const BRIEF_MARKDOWN_CHARS = 12_000;
const LISTING_EXCERPT_CHARS = 4_000;
const LISTING_ENGLISH_CHARS = 6_000;
const DRAFT_EXCERPT_CHARS = 6_000;
const TEXT_CHARS = 1_200;

export type GigReportPlanFact = {
  label: string;
  model: string;
  effort: string | null;
  status: GigPlanRow["status"];
  accepted: boolean;
  summary: string | null;
  steps: { title: string; doneWhen: string }[];
  decisions: string[];
  risks: string[];
  effortHours: { min: number; max: number } | null;
  questions: string[];
  costUsd: number | null;
  durationMs: number | null;
  fallbackReason: string | null;
};

export type GigReportFacts = {
  stage: GigReportStage;
  /** The report's track (reportTrackOf): a freelance bid reports its client proposal where
   *  a build reports its draft, evidence and review. */
  track: GigTrack;
  /** The client proposal's record (proposal track), never its HTML: where the file is, who
   *  wrote it, the bid message's opening and the asks. Null when none was written. */
  proposal: {
    path: string;
    status: string;
    source: "llm" | "deterministic";
    generatedAt: string;
    fromAcceptedPlan: boolean;
    messageExcerpt: string;
    questions: string[];
    artifacts: string[];
  } | null;
  /** The newest timestamp among the records the report reads: a report generated after it
   *  is current. */
  factsAt: string;
  gig: {
    id: string;
    title: string;
    listingTitle: string;
    arena: string;
    arenaLabel: string;
    typeLabel: string;
    org: string | null;
    url: string;
    status: Gig["status"];
    createdAt: string;
    postedAt: string | null;
    deadlineAt: string | null;
    tags: string[];
    reward: { text: string; amount: number | null; currency: string | null; usd: { amount: number; rate: number; rateAt: string; source: string } | null } | null;
    sourceState: GigSourceState | null;
    suspectReasons: string[];
    withdrawnFor: string | null;
    listingExcerpt: string;
  };
  brief: {
    category: string;
    difficulty: string;
    difficultyReason: string | null;
    effort: { minHours: number; maxHours: number; note: string | null } | null;
    challenges: string[];
    markdown: string;
    language: string | null;
    listingEnglish: string | null;
    missingArtifacts: string[];
    outreachMessage: string | null;
    workKind: string | null;
    workKindReason: string | null;
    source: "llm" | "deterministic";
    fallbackReason: string | null;
    createdAt: string;
    links: { url: string; status: string }[];
  } | null;
  plans: GigReportPlanFact[];
  accepted: (GigReportPlanFact & { note: string | null; acceptedAt: string | null; goals: { step: string; status: GigGoalStatus; progress: number; note: string | null }[] }) | null;
  attempt: {
    status: GigAttempt["status"];
    createdAt: string;
    summary: string | null;
    draftExcerpt: string | null;
    draftChars: number | null;
    draftLines: number | null;
    artifacts: { kind: string; title: string; ref: string }[];
    evidence: { kind: GigEvidenceKind; command: string | null; result: string; passed: boolean | null }[];
    disclosure: string | null;
    confidence: number | null;
    questions: string[];
    review: { note: string | null; ticked: number; total: number; reviewedAt: string } | null;
    costUsd: number | null;
    fallbackReason: string | null;
    sentAt: string | null;
    revisionNote: string | null;
  } | null;
  attempts: { total: number; failed: number };
  lint: { severity: DraftLintFinding["severity"]; text: string }[];
  outcomes: { verdict: GigOutcomeVerdict; amount: number | null; currency: string | null; feedbackText: string | null; source: string; recordedAt: string }[];
  money: {
    /** The reward in US dollars: the listing's own figure when it is USD, else the scan's
     *  conversion; null when neither exists. */
    rewardUsd: number | null;
    rewardUsdIsEstimate: boolean;
    /** Reward / effort, from the accepted plan's effort when there is one, else the brief's. */
    ratePerHourUsd: { min: number; max: number } | null;
    rateBasis: string | null;
    spentUsd: { plans: number | null; agentRuns: number | null; total: number | null };
    /** Model and agent runs whose cost was never reported (a lower bound, not zero). */
    unreported: number;
  };
};

export type GigReportFactsInput = {
  gig: Gig;
  plans: readonly GigPlanRow[];
  attempts: readonly GigAttempt[];
  outcomes: readonly GigOutcome[];
  source: Pick<GigSource, "pausedReason" | "invalidStreak" | "host"> | null;
  now: Date;
};

const CLOSED_STATUSES: readonly Gig["status"][] = ["accepted", "rejected", "expired", "withdrawn", "declined"];

/** The track the REPORT follows: a freelance gig is a proposal (gigTrackOf) - unless it was
 *  already drafted by a persona before the tracks split and has no proposal, in which case
 *  its report keeps describing that draft. Pure. */
export function reportTrackOf(gig: Pick<Gig, "arena" | "proposal">, attempts: readonly Pick<GigAttempt, "specialistId" | "deliverable">[]): GigTrack {
  if (gigTrackOf(gig.arena) !== "proposal") return "build";
  const personaDraft = attempts.some((a) => a.deliverable !== null && a.specialistId !== GIG_PROPOSAL_SPECIALIST_ID);
  return gig.proposal === null && personaDraft ? "build" : "proposal";
}

/** The stage the records say the gig is at, or null when there is nothing to report yet
 *  (no research brief). Pure. */
export function gigReportStageOf(input: Pick<GigReportFactsInput, "gig" | "plans" | "attempts" | "outcomes">): GigReportStage | null {
  const { gig, plans, attempts, outcomes } = input;
  if (!gig.brief) return null;
  if (outcomes.length > 0 || CLOSED_STATUSES.includes(gig.status)) return "closed";
  if (gig.status === "sent" || attempts.some((a) => a.status === "sent")) return "sent";
  if (gig.status === "drafted" || gig.status === "in_review" || attempts.some((a) => a.deliverable !== null)) return "drafted";
  if (plans.some((p) => p.acceptedAt !== null)) return "accepted";
  if (plans.some((p) => p.status === "ready" || p.status === "failed")) return "planned";
  return "researched";
}

function latest(...stamps: (string | null | undefined)[]): string {
  let best = "";
  for (const s of stamps) if (typeof s === "string" && s > best) best = s;
  return best;
}

function clip(text: string | null | undefined, max: number): string | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function sumKnown(values: readonly (number | null)[]): number | null {
  const known = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
  return known.length > 0 ? Math.round(known.reduce((a, b) => a + b, 0) * 1e6) / 1e6 : null;
}

function planFact(row: GigPlanRow): GigReportPlanFact {
  return {
    label: planSeatLabel(row),
    model: row.model,
    effort: row.effort,
    status: row.status,
    accepted: row.acceptedAt !== null,
    summary: row.plan?.summary ?? null,
    steps: row.plan?.steps ?? [],
    decisions: row.plan?.decisions ?? [],
    risks: row.plan?.risks ?? [],
    effortHours: row.plan?.effortHours ?? null,
    questions: row.plan?.questions ?? [],
    costUsd: row.costUsd,
    durationMs: row.durationMs,
    fallbackReason: row.fallbackReason,
  };
}

/** The newest round's rows (the store lists newest round first), plus the accepted row when
 *  it belongs to an older round. */
function currentRound(plans: readonly GigPlanRow[]): GigPlanRow[] {
  if (plans.length === 0) return [];
  const newest = plans[0].createdAt;
  const round = plans.filter((p) => p.createdAt === newest);
  const accepted = plans.find((p) => p.acceptedAt !== null);
  return accepted && !round.includes(accepted) ? [accepted, ...round] : round;
}

/** The attempt the report describes: the newest one that carries a deliverable, else the
 *  newest one. */
function reportAttempt(attempts: readonly GigAttempt[]): GigAttempt | null {
  for (let i = attempts.length - 1; i >= 0; i--) if (attempts[i].deliverable) return attempts[i];
  return attempts.length > 0 ? attempts[attempts.length - 1] : null;
}

const LINT_TEXT: Readonly<Record<DraftLintFinding["messageKey"], (p: Record<string, string | number>) => string>> = {
  noDeliverable: () => "No deliverable came back. There is nothing to review.",
  sourceInvalidStreak: (p) => `${p.host} was auto-paused after a run of rejected outcomes; sending more work there adds to that streak.`,
  deadlinePassed: (p) => `The listing closed on ${p.deadline}. There is nowhere to send this.`,
  evidenceFailed: (p) => `Evidence ${p.n} (${p.kind}) failed.`,
  evidenceNoCommand: (p) => `Evidence ${p.n} (${p.kind}) has no command: it is the agent's account, not a run log.`,
  doubledWord: (p) => `Doubled words "${p.excerpt}" on line ${p.line ?? "?"}: a template seam shows in the text.`,
  rewardMentioned: (p) => `Mentions money ("${p.excerpt}"), but the listing states no reward.`,
  disclosureAbsent: () => "The draft carries no AI-use disclosure sentence.",
  disclosureNotInDraft: () => "The disclosure sentence is not in the draft text.",
  questionOpen: (p) => `The agent asks: "${p.question}"`,
  costUnreported: () => "The run's cost was never reported. That is unknown, not $0.",
};

function rewardUsd(gig: Gig): { usd: number | null; estimate: boolean } {
  const r = gig.reward;
  if (!r || r.amount === null) return { usd: null, estimate: false };
  if ((r.currency ?? "").toUpperCase() === "USD") return { usd: r.amount, estimate: false };
  return r.usd ? { usd: r.usd.amount, estimate: true } : { usd: null, estimate: false };
}

/** Assemble the facts. Pure. */
export function buildGigReportFacts(input: GigReportFactsInput): GigReportFacts | null {
  const stage = gigReportStageOf(input);
  if (!stage) return null;
  const { gig, attempts, outcomes, source, now } = input;
  const round = currentRound(input.plans);
  const acceptedRow = input.plans.find((p) => p.acceptedAt !== null) ?? null;
  const attempt = reportAttempt(attempts);
  const dl = attempt?.deliverable ?? null;
  const brief = gig.brief;

  const usd = rewardUsd(gig);
  const effort = acceptedRow?.plan?.effortHours ? { min: acceptedRow.plan.effortHours.min, max: acceptedRow.plan.effortHours.max, from: "the accepted plan" } : brief?.effort ? { min: brief.effort.minHours, max: brief.effort.maxHours, from: "the research brief" } : null;
  const rate = usd.usd !== null && effort && effort.min > 0 && effort.max >= effort.min ? { min: Math.round(usd.usd / effort.max), max: Math.round(usd.usd / effort.min) } : null;
  const rateBasis = rate && effort ? `${usd.estimate ? "USD estimate of the reward" : "the reward"} (${usd.usd} USD) over ${effort.min}-${effort.max} hours from ${effort.from}` : null;

  const planCosts = input.plans.filter((p) => p.status === "ready" || p.status === "failed").map((p) => p.costUsd);
  const runCosts = attempts.filter((a) => a.status !== "dispatched" && a.status !== "running").map((a) => a.costUsd);
  const plansSpent = sumKnown(planCosts);
  const runsSpent = sumKnown(runCosts);

  const lint = attempt && dl
    ? lintDraft({ gig, attempt, source, now }).map((f) => ({ severity: f.severity, text: LINT_TEXT[f.messageKey]({ ...f.params, line: f.line ?? "?" }) }))
    : [];

  const accepted = acceptedRow
    ? {
        ...planFact(acceptedRow),
        note: acceptedRow.note,
        acceptedAt: acceptedRow.acceptedAt,
        goals: (acceptedRow.progress?.goals ?? []).map((g) => ({
          step: acceptedRow.plan?.steps[g.stepIndex]?.title ?? `Step ${g.stepIndex + 1}`,
          status: g.status,
          progress: g.progress,
          note: g.note,
        })),
      }
    : null;

  const p = gig.proposal;
  return {
    stage,
    track: reportTrackOf(gig, attempts),
    proposal:
      p && p.status !== "writing"
        ? {
            path: p.path,
            status: p.status,
            source: p.source,
            generatedAt: p.generatedAt,
            fromAcceptedPlan: p.planId !== null,
            messageExcerpt: p.message.slice(0, 800),
            questions: p.questions.slice(0, 8),
            artifacts: p.artifacts.slice(0, 8),
          }
        : null,
    factsAt: latest(gig.updatedAt, p?.generatedAt, brief?.createdAt, ...input.plans.map((p) => p.updatedAt), ...attempts.map((a) => a.updatedAt), ...outcomes.map((o) => o.recordedAt)),
    gig: {
      id: gig.id,
      title: brief?.title?.trim() || gig.title,
      listingTitle: gig.title,
      arena: gig.arena,
      arenaLabel: GIG_ARENA_LABEL[gig.arena] ?? gig.arena,
      typeLabel: GIG_TYPE_LABEL[gigTypeOf(gig)],
      org: gig.org,
      url: gig.url,
      status: gig.status,
      createdAt: gig.createdAt,
      postedAt: gig.postedAt,
      deadlineAt: gig.deadlineAt,
      tags: gig.tags.slice(0, 20),
      reward: gig.reward ? { text: gig.reward.text, amount: gig.reward.amount, currency: gig.reward.currency, usd: gig.reward.usd ?? null } : null,
      sourceState: gig.sourceState,
      suspectReasons: [...gig.suspectReasons],
      withdrawnFor: gig.withdrawReason?.challenge ?? null,
      listingExcerpt: gig.bodyText.slice(0, LISTING_EXCERPT_CHARS),
    },
    brief: brief
      ? {
          category: brief.category,
          difficulty: brief.difficulty,
          difficultyReason: brief.difficultyReason,
          effort: brief.effort,
          challenges: brief.challenges.slice(0, 12),
          markdown: brief.markdown.slice(0, BRIEF_MARKDOWN_CHARS),
          language: brief.language ?? null,
          listingEnglish: brief.listingEnglish ? brief.listingEnglish.slice(0, LISTING_ENGLISH_CHARS) : null,
          missingArtifacts: brief.missingArtifacts ?? [],
          outreachMessage: brief.outreachMessage ?? null,
          workKind: brief.workKind ?? null,
          workKindReason: brief.workKindReason ?? null,
          source: brief.source,
          fallbackReason: brief.fallbackReason,
          createdAt: brief.createdAt,
          links: brief.links.slice(0, 12).map((l) => ({ url: l.url, status: l.status })),
        }
      : null,
    plans: round.map(planFact),
    accepted,
    attempt: attempt
      ? {
          status: attempt.status,
          createdAt: attempt.createdAt,
          summary: clip(dl?.summary, TEXT_CHARS),
          draftExcerpt: dl ? dl.draftText.slice(0, DRAFT_EXCERPT_CHARS) : null,
          draftChars: dl ? dl.draftText.length : null,
          draftLines: dl ? dl.draftText.split(/\r?\n/).length : null,
          artifacts: (dl?.artifacts ?? []).slice(0, 20).map((a) => ({ kind: a.kind, title: a.title, ref: a.ref })),
          evidence: (dl?.evidence ?? []).slice(0, 30).map((e) => ({ kind: e.kind, command: e.command, result: clip(e.result, 600) ?? "", passed: e.passed })),
          disclosure: clip(dl?.disclosure, 600),
          confidence: dl ? dl.confidence : null,
          questions: (dl?.questions ?? []).slice(0, 10),
          review: attempt.review
            ? {
                note: attempt.review.note,
                ticked: Object.values(attempt.review.checklist).filter(Boolean).length,
                total: Object.keys(attempt.review.checklist).length,
                reviewedAt: attempt.review.reviewedAt,
              }
            : null,
          costUsd: attempt.costUsd,
          fallbackReason: attempt.fallbackReason,
          sentAt: attempt.sentAt,
          revisionNote: attempt.revisionNote,
        }
      : null,
    attempts: { total: attempts.length, failed: attempts.filter((a) => a.status === "failed").length },
    lint,
    outcomes: outcomes.map((o) => ({ verdict: o.verdict, amount: o.amount, currency: o.currency, feedbackText: clip(o.feedbackText, TEXT_CHARS), source: o.source, recordedAt: o.recordedAt })),
    money: {
      rewardUsd: usd.usd,
      rewardUsdIsEstimate: usd.estimate,
      ratePerHourUsd: rate,
      rateBasis,
      spentUsd: { plans: plansSpent, agentRuns: runsSpent, total: sumKnown([plansSpent, runsSpent]) },
      unreported: planCosts.filter((c) => c === null).length + runCosts.filter((c) => c === null).length,
    },
  };
}
