import { Briefcase, GraduationCap, Repeat, type LucideIcon } from "lucide-react";
import type { GithubEvidenceSummary } from "@/app/_lib/github-summary";
import type { MatchScoreProvenance } from "@/app/_lib/match-score";
import { DEFAULT_STAGE_AXIS, PIPELINE_STAGES, roleOf, STAGE_ROLE, type StageDef, type StageRole } from "@/app/_lib/pipeline-stages";

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
  // ONE THREAD (gap 2) — the WORK-SAMPLE transfer score behind an entry promoted
  // from an assignment, stamped by GET /api/pipeline (pipeline-transfer-score.ts)
  // from the linked `dev_submissions` row. A different question from the match
  // score and deliberately a different field: `displayScoreOf` decides which of
  // the two a surface shows and tags the kind, and nothing ranks on this one.
  transferScore?: number | null;
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
  Hired: "Offer accepted — candidate hired; the role closes here.",
};

export const STALE_DAYS = 10; // legacy flat default — fallback for unknown stages

// Per-ROLE aging SLAs in days (PIPE4). A candidate sitting 10 days at an offer is
// a stall worth chasing; 10 days freshly arrived is normal. Stage-appropriate
// thresholds flag the right cards instead of one blunt global cut. Keyed by what a
// column MEANS, not what it is called: the axis is workspace-editable (Settings →
// Hiring), and a threshold keyed to the name "Interview" stops firing the moment a
// team renames the column to "First round" and adds a "Tech round" beside it — the
// badge goes quiet with nothing on screen admitting it. `scoring` waits like an
// interview (a candidate genuinely sits there until a human ratifies the number);
// `terminal` never ages; `custom` maps to no product semantics, so it gets the
// flat legacy cut. Recruiters can override these per board (localStorage, keyed by
// column id), so these are defaults, not hard limits.
export const ROLE_SLA_DEFAULTS: Record<StageRole, number> = {
  entry: 14,
  screening: 7,
  interview: 5,
  scoring: 5,
  offer: 3,
  terminal: 0,
  custom: STALE_DAYS,
};

/** The shipped five, by name — DERIVED from the role table so the two can never
 *  disagree. Kept for callers that only know a canonical name (and as the fallback
 *  for a retired id that is no longer on any axis but still has rows standing on
 *  it: a candidate stranded on the old "Offer" column still ages like an offer). */
export const STAGE_SLA_DEFAULTS: Record<string, number> = Object.fromEntries(
  PIPELINE_STAGES.map((id) => [id, ROLE_SLA_DEFAULTS[STAGE_ROLE[id]]])
);

/** Days a candidate may sit in `stage` before the board flags it as aging, given
 *  optional per-board overrides and the axis the board is rendering. Resolution
 *  order: the recruiter's override for this column id → the default for the ROLE
 *  the column plays on `axis` → the shipped default for a canonical name that is
 *  off the axis (retired) → the flat STALE_DAYS for a stage nothing knows. A
 *  non-positive value (terminal = 0) means the stage never ages — callers already
 *  exclude terminal roles, but this keeps it explicit. Byte-identical to the old
 *  name-keyed table on the shipped axis. */
export function slaForStage(
  stage: string,
  overrides?: Record<string, number> | null,
  axis: readonly StageDef[] = DEFAULT_STAGE_AXIS
): number {
  const o = overrides?.[stage];
  if (typeof o === "number" && o > 0) return o;
  const role = roleOf(stage, axis);
  if (role) return ROLE_SLA_DEFAULTS[role];
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
