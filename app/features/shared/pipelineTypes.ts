import { Briefcase, GraduationCap, Repeat, type LucideIcon } from "lucide-react";
import type { GithubEvidenceSummary } from "@/app/_lib/github-summary";
import type { MatchScoreProvenance } from "@/app/_lib/match-score";
import { DEFAULT_STAGE_AXIS, PIPELINE_STAGES, type StageDef } from "@/app/_lib/pipeline-stages";

export type { StageDef } from "@/app/_lib/pipeline-stages";

export type Entry = {
  id: string;
  candidateId: string | null;
  candidateLabel: string;
  archetype: string | null;
  roleFamily: string | null;
  jobId: string | null;
  jobTitle: string | null;
  stage: string;
  matchScore: number | null;
  status: string;
  approvalKind: string | null;
  approvalDetail: string | null;
  createdAt: string | null;
  stageChangedAt: string | null;
  // Set when the application couldn't be normalized into a matchable profile and
  // is a label-only stub needing manual capture; reason holds the failure detail.
  intakeDegraded?: boolean;
  intakeDegradedReason?: string | null;
  // GH2 — compact GitHub evidence attached at add-to-pipeline (null/absent on
  // entries added without a deep-dive). Rendered in the drawer.
  githubEvidence?: GithubEvidenceSummary | null;
  // Self-reported GitHub handle captured at inbound apply (normalized bare
  // username). The drawer offers the on-demand deep-dive from it when no
  // evidence has been attached yet.
  githubHandle?: string | null;
  // Persistent per-candidate recruiter note, autosaved from the drawer via the
  // set_notes action (null/absent when none has been written yet).
  notes?: string | null;
  // d95fed6d — which surface/channel filed this candidate ("match", "matrix",
  // "analyze", "sourcing", "devcase", or a webhook channel id). Null on legacy
  // and unattributed entries. Rendered as the drawer's origin chip.
  sourceChannel?: string | null;
  // variant-reaches-the-drawer — E5 campaign/creative attribution (utm_campaign /
  // utm_content-style), persisted on the entry and aggregated in analytics. Surfaced
  // in the drawer's origin line so campaign attribution is visible where advance/
  // reject decisions happen. Null when the source carried none (the common case).
  sourceCampaign?: string | null;
  sourceVariant?: string | null;
  // Canonical match-score read path (REC-01 / OO-L2-10) — stamped by
  // GET /api/pipeline (match-score-resolve.ts): THE score to display (freshest
  // job-matched analysis > matchScore snapshot > null) plus where it came from.
  // Optional so locally-constructed entries degrade to the matchScore fallback.
  canonicalScore?: number | null;
  scoreProvenance?: MatchScoreProvenance | null;
};

// One job "lane" on the pipeline board: PipelineTab builds Position[] (via
// groupPositions) and passes it straight to <PipelineBoard positions={...} />, so
// the producer and the consumer share this ONE declaration instead of each keeping
// a private copy that could silently drift.
export type Position = { id: string; title: string; family: string; count: number };

// THE position/lane key for an entry: job id, else job title, else "?". The board's
// lane COUNT (groupPositions) and lane MEMBERSHIP (PipelineBoard's filter) must
// compute this identically — a 2-way vs 3-way fallback mismatch once counted an
// entry under "?" but placed it in no lane (bug-hunt-2026-06-07). One function so
// the count and the rendered lanes are provably keyed the same way.
export function entryLaneKey(e: Pick<Entry, "jobId" | "jobTitle">): string {
  return e.jobId ?? e.jobTitle ?? "?";
}

// Mirrors the PUBLIC event projection served by /api/pipeline/events
// (pipeline-events-public.ts): candidateLabel is initials only, and the
// internal entryId/archetype never reach the client (idea-4c41d103).
export type PipelineEvent = {
  id: number;
  candidateLabel: string | null;
  jobTitle: string | null;
  kind: string;
  toStage: string | null;
  detail: string | null;
  createdAt: string;
};

// Consolidated 5-stage board model. Single-sourced from the canonical
// PIPELINE_STAGES axis (pipeline-stages.ts is DB-free, so it's safe in the client
// bundle — CandidateDrawer already imports it) instead of a hand-maintained literal
// copy that could drift from the drawer's move dropdown. "Accepted" = CV received
// (inbound application OR proactively sourced), waiting to be screened; "Screened"
// = run through the first wave of evaluation (matching + AI screening). Typed as
// readonly string[] so the existing `.includes(someString)` call sites keep
// working without per-site narrowing.
export const STAGES: readonly string[] = PIPELINE_STAGES;

/** The shipped board axis (ids + labels + roles), for a client that has not yet
 *  been handed the workspace's own. `PipelineBoard` takes the resolved axis from
 *  GET /api/pipeline and falls back to this, so a caller mid-migration renders
 *  exactly what it always did rather than an empty board. */
export const DEFAULT_BOARD_AXIS: readonly StageDef[] = DEFAULT_STAGE_AXIS;

// One-line, new-user-friendly explanation of what each board stage represents,
// surfaced as the column-header tooltip so the funnel is self-explaining.
export const STAGE_HELP: Record<string, string> = {
  Accepted: "CV received — an inbound application or a proactively-sourced candidate, waiting to be screened.",
  Screened: "Run through the first wave of evaluation — matched and AI-screened; strong matches advance, the rest wait on a human decision.",
  Interview: "Interviewing — slot scheduling, AI voice screen, and scorecard.",
  Offer: "An offer is being drafted, reviewed, or sent.",
  Hired: "Offer accepted — candidate hired and onboarding.",
};

export const STALE_DAYS = 10; // legacy flat default — fallback for unknown stages

// Per-stage aging SLAs in days (PIPE4). A candidate sitting 10 days in Offer is a
// stall worth chasing; 10 days freshly Accepted is normal. Stage-appropriate
// thresholds flag the right cards instead of one blunt global cut. Hired never
// ages. Recruiters can override these per board (localStorage), so these are
// defaults, not hard limits.
export const STAGE_SLA_DEFAULTS: Record<string, number> = {
  Accepted: 14,
  Screened: 7,
  Interview: 5,
  Offer: 3,
  Hired: 0,
};

/** Days a candidate may sit in `stage` before the board flags it as aging, given
 *  optional per-board overrides. Falls back to the per-stage default, then the flat
 *  STALE_DAYS for an unknown stage. A non-positive value (e.g. Hired = 0) means the
 *  stage never ages — callers already exclude Hired, but this keeps it explicit. */
export function slaForStage(stage: string, overrides?: Record<string, number> | null): number {
  const o = overrides?.[stage];
  if (typeof o === "number" && o > 0) return o;
  const d = STAGE_SLA_DEFAULTS[stage];
  return typeof d === "number" ? d : STALE_DAYS;
}

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

// ONE catalog of archetype presentation — label, fill (bg), focus ring, and glyph.
// Every archetype-styled surface (candidate row, drawer, legend, analytics) reads
// from this single source so a label/color/icon tweak lands in exactly one place
// instead of drifting across the copies that used to live in PipelineShared
// (ARCHETYPE_ICON) and CandidateDrawerTypes (ARCHETYPE). The glyph lets a surface
// read without relying on hue alone (mirrors Badge's icon-plus-label doctrine).
export type ArchetypeStyle = { label: string; bg: string; ring: string; icon: LucideIcon };

export const ARCHETYPE_STYLE: Record<string, ArchetypeStyle> = {
  bau: { label: "Experienced", bg: "bg-steel", ring: "ring-steel", icon: Briefcase },
  student: { label: "Student", bg: "bg-coral", ring: "ring-coral", icon: GraduationCap },
  career_switcher: { label: "Switcher", bg: "bg-moss", ring: "ring-moss", icon: Repeat },
};
export const styleFor = (a: string | null): ArchetypeStyle => ARCHETYPE_STYLE[a ?? "bau"] ?? ARCHETYPE_STYLE.bau;
