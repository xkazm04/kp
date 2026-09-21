// The detail page's projection of a stored posting — what crosses from the server
// page to the client component. No React, no store import: pure shaping, so the
// server page and a test can both call it. The raw JSON-LD, the structured Job and
// the full MatchResult stay on the server; the page needs the body as text, the
// skill lists, the breakdown, the confidence, the eligibility and the reasoning.

import type { EligibilityFlag, FitTier, JobseekerPosting, PostingStatus, DismissReason, SalaryPeriod, WorkMode } from "@/app/_lib/jobseeker/types";
import type { Confidence, ScoreDimension } from "@/app/features/shared/matchTypes";

export type PostingReasoningView = {
  verdict: string;
  strengths: string[];
  gaps: string[];
  probes: string[];
};

export type PostingMatchView = {
  total: number;
  fitTier: FitTier | null;
  matchedSkills: string[];
  missingSkills: string[];
  unprovenSkills: string[];
  breakdown: ScoreDimension[];
  confidence: Confidence | null;
  eligibility: EligibilityFlag[];
};

export type PostingDetailView = {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  workMode: WorkMode | null;
  postedAt: string | null;
  lastSeenAt: string | null;
  url: string;
  sourceLabel: string;
  /** The feed's attribution line for the source (EURES asks for it on every posting). */
  attribution: string | null;
  salary: { min: number | null; max: number | null; currency: string | null; period: SalaryPeriod | null };
  bodyText: string;
  status: PostingStatus;
  dismissReason: DismissReason | null;
  dismissNote: string | null;
  match: PostingMatchView | null;
  reasoning: PostingReasoningView | null;
  jobSource: "deterministic" | "llm" | null;
};

const MAX_BODY_CHARS = 40_000;

function strings(v: unknown, max = 40): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, max) : [];
}

export function matchView(match: Record<string, unknown> | null, total: number | null, fitTier: FitTier | null): PostingMatchView | null {
  if (total === null) return null;
  const m = match ?? {};
  const breakdown = Array.isArray(m.scoreBreakdown)
    ? (m.scoreBreakdown as unknown[])
        .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
        .map((d) => ({
          key: String(d.key ?? ""),
          label: String(d.label ?? d.key ?? ""),
          labelCode: typeof d.labelCode === "string" ? d.labelCode : undefined,
          percent: typeof d.percent === "number" ? d.percent : 0,
          weight: typeof d.weight === "number" ? d.weight : 0,
          contribution: typeof d.contribution === "number" ? d.contribution : 0,
        }))
    : [];
  const c = m.confidence && typeof m.confidence === "object" ? (m.confidence as Record<string, unknown>) : null;
  const confidence: Confidence | null =
    c && typeof c.low === "number" && typeof c.high === "number" && (c.level === "tight" || c.level === "moderate" || c.level === "wide")
      ? { low: c.low, high: c.high, level: c.level, drivers: strings(c.drivers, 10) }
      : null;
  const eligibility = Array.isArray(m.eligibility)
    ? (m.eligibility as unknown[]).filter(
        (f): f is EligibilityFlag => !!f && typeof f === "object" && typeof (f as EligibilityFlag).key === "string" && typeof (f as EligibilityFlag).state === "string"
      )
    : [];
  return {
    total,
    fitTier,
    matchedSkills: strings(m.matchedSkills),
    missingSkills: strings(m.missingSkills),
    unprovenSkills: strings(m.unprovenSkills),
    breakdown,
    confidence,
    eligibility,
  };
}

export function reasoningView(reasoning: Record<string, unknown> | null): PostingReasoningView | null {
  if (!reasoning) return null;
  const verdict = typeof reasoning.verdict === "string" ? reasoning.verdict.trim() : "";
  if (!verdict) return null;
  return { verdict, strengths: strings(reasoning.strengths, 8), gaps: strings(reasoning.gaps, 8), probes: strings(reasoning.interviewProbes, 8) };
}

/** What the deep-dive door answered, as ONE word the page can branch on. The door's
 *  shape is documented in app/api/jobseeker/postings/[id]/deepdive/route.ts:
 *  `source` says who wrote the rationale, `fallbackReason` says why it is not a model's.
 *  A keyless answer is `no_provider` or `template` — both honest states that render the
 *  fixed-template note, NEVER an error and never a silent no-op. Anything the door did
 *  not shape this way (a 4xx/5xx body, an unparsable answer) is `failed`. */
export type DiveOutcome = "llm" | "template" | "no_provider" | "failed";

export function diveOutcome(body: { source?: unknown; fallbackReason?: unknown } | null | undefined): DiveOutcome {
  if (!body || typeof body !== "object") return "failed";
  if (body.source === "llm") return "llm";
  if (body.source !== "deterministic") return "failed";
  return body.fallbackReason === "no_provider" ? "no_provider" : "template";
}

export function postingDetailView(p: JobseekerPosting, sourceLabel: string, attribution: string | null): PostingDetailView {
  return {
    id: p.id,
    title: p.title,
    company: p.company,
    location: p.location,
    workMode: p.workMode,
    postedAt: p.postedAt,
    lastSeenAt: p.lastSeenAt,
    url: p.url,
    sourceLabel,
    attribution,
    salary: { min: p.salaryMin, max: p.salaryMax, currency: p.salaryCurrency, period: p.salaryPeriod },
    bodyText: p.bodyText.slice(0, MAX_BODY_CHARS),
    status: p.status,
    dismissReason: p.dismissReason,
    dismissNote: p.dismissNote,
    match: matchView(p.match, p.matchTotal, p.fitTier),
    reasoning: reasoningView(p.reasoning),
    jobSource: p.jobSource,
  };
}
