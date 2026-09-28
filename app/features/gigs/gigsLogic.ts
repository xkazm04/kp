import { GIG_CHECKLISTS } from "@/app/_lib/gigs/checklists";
import { lintGate, type DraftLintFinding } from "@/app/_lib/gigs/draft-lint";
import { canTransitionGig } from "@/app/_lib/gigs/transitions";
import {
  GIG_ARENAS,
  GIG_DISCLOSURE_ITEM,
  type GigBriefSection,
  type GigDifficulty,
  type GigSourceRunOutcome,
  type Gig,
  type GigArena,
  type GigAttempt,
  type GigKpi,
  type GigKpiCell,
  type GigSource,
  type GigSpecialist,
  type GigStatus,
} from "@/app/_lib/gigs/types";

// Pure derivations for the Gigs tab: which queue a gig sits in, how far along the line it
// provably got, the rate as a fraction, the desk's Approve and Mark sent gates, and the
// keyboard guards. The fused desk's own derivations (front columns, lanes, the whole file,
// the reviewer note, margin notes) live in deskLogic.ts. No React, no fetch, the clock
// passed in - pinned by gigsLogic.test.ts.

// ---------------------------------------------------------------------------
// Wire shapes the tab reads (the routes' answers, typed once here)
// ---------------------------------------------------------------------------

export type GigsListAnswer = { gigs: Gig[]; specialists: GigSpecialist[]; attemptsByGig: Record<string, GigAttempt> };

export type SpecialistHire = {
  id: string;
  status: string;
  personaId: string | null;
  personaName: string | null;
  requestId: string | null;
  updatedAt: string;
  lastReportAt: string | null;
};
export type SpecialistRow = GigSpecialist & { hire: SpecialistHire | null };

export type SourceRow = GigSource & { termsCurrent: boolean };

/** What a page calls after a write: `flash` = one sentence for the page's status line.
 *  Answers the re-read KPI, so a verdict can say how the rate moved. */
export type AfterWrite = (flash?: string | null) => Promise<GigKpi | null>;

/** The catalog entry as GET /api/gigs/sources serves it (sources-catalog.ts). Declared
 *  here rather than imported: that module hashes with node:crypto and must stay off the
 *  client graph. */
export type CatalogEntry = {
  adapter: string;
  arena: GigArena | null;
  tier: "A" | "B" | "C";
  label: string;
  host: string | null;
  needsKey: boolean;
  envVars: string[];
  keylessBehaviour: string;
  termsSummary: string;
  termsUrl: string | null;
  termsHash: string | null;
  declines: "no_public_api" | "manual_only" | null;
  creatable: boolean;
  checkedOn: string;
};

// ---------------------------------------------------------------------------
// Who acts next on a gig
// ---------------------------------------------------------------------------

/** The three judgements the header counts and `N` walks, in that order; then triage (the
 *  operator's too, but not a judgement), then the kinds that sit with the agents and
 *  never pad the operator's count. */
export const NEED_KINDS = ["review", "suspect", "record"] as const;
export type NeedKind = (typeof NEED_KINDS)[number];
export const QUEUE_KINDS = [...NEED_KINDS, "triage", "running", "revision", "failed"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export type QueueItem = {
  kind: QueueKind;
  /** Stable selection key: kind + gig id (one open item per gig). */
  key: string;
  gig: Gig;
  attempt: GigAttempt | null;
};

/** Which queue a gig sits in, or null when it needs nobody (declined, resolved...). */
export function queueKindOf(gig: Gig, latest: GigAttempt | null): QueueKind | null {
  if (gig.status === "suspect") return "suspect";
  if (gig.status === "sent") return "record";
  if (latest && (latest.status === "drafted" || latest.status === "approved")) return "review";
  if (latest && (latest.status === "dispatched" || latest.status === "running")) return "running";
  if (latest && latest.status === "revision_requested") return "revision";
  if (gig.status === "new") return "triage";
  if (gig.status === "qualified") return latest && latest.status === "failed" ? "failed" : "triage";
  return null;
}

// ---------------------------------------------------------------------------
// The line: arenas are rows, the lifecycle steps are columns
// ---------------------------------------------------------------------------

/** The canonical steps of the line, in order (reachedStep reads them). */
export const LINE_STEPS = ["new", "suspect", "qualified", "dispatched", "drafted", "in_review", "sent", "accepted", "rejected"] as const satisfies readonly GigStatus[];
export type LineStep = (typeof LINE_STEPS)[number];
/** How far along the main line a gig has provably got. `suspect` is a side branch, not
 *  a rank; a gig that left the line is read off its latest attempt. */
const FLOW_RANK: Partial<Record<GigStatus, number>> = { new: 0, qualified: 1, dispatched: 2, drafted: 3, in_review: 4, sent: 5, accepted: 6, rejected: 6 };

function furthestRank(gig: Gig, latest: GigAttempt | null): number {
  const own = FLOW_RANK[gig.status];
  if (own !== undefined) return own;
  if (!latest) return 0;
  if (latest.status === "sent") return 5;
  if (latest.deliverable) return 3;
  return 2;
}

/** Whether any of these gigs ever reached `step`. An empty cell of a step they reached
 *  says "none here now"; one they never reached says "never reached" - the two are
 *  different facts and never render alike (Lanes, deskLogic laneRows). */
export function reachedStep(gigs: readonly Gig[], attemptsByGig: Readonly<Record<string, GigAttempt>>, step: LineStep): boolean {
  if (step === "suspect") return gigs.some((g) => g.status === "suspect" || g.suspectReasons.length > 0);
  if (step === "accepted" || step === "rejected") return gigs.some((g) => g.status === step);
  const need = FLOW_RANK[step]!;
  return gigs.some((g) => furthestRank(g, attemptsByGig[g.id] ?? null) >= need);
}

/** Whether the quick decline (`D`) is offered: exactly the statuses PATCH
 *  /api/gigs/[id] {action:"decline"} accepts, read off the same transition table. */
export function canQuickDecline(status: GigStatus): boolean {
  return canTransitionGig(status, "declined");
}

/** The rejected streak's tone as it nears the auto-pause: calm under 40% of the limit
 *  (0 of 5 reads calm, never absent), watch under 80%, near below the limit, at it. */
export type StreakTone = "calm" | "watch" | "near" | "at";
export function streakTone(count: number, limit: number): StreakTone {
  if (limit <= 0 || count >= limit) return "at";
  const r = count / limit;
  return r < 0.4 ? "calm" : r < 0.8 ? "watch" : "near";
}

/** How many of the four difficulty bars are filled; 0 for `unrated`, which is drawn
 *  hollow and dashed - an absence, never "easy". */
export function difficultyBars(d: GigDifficulty): 0 | 1 | 2 | 3 | 4 {
  return d === "easy" ? 1 : d === "moderate" ? 2 : d === "hard" ? 3 : d === "very_hard" ? 4 : 0;
}

/** A brief heading's plain text: its Markdown escapes and emphasis removed. RESTATES
 *  research.ts `plainHeadingText` (a server module the client must not import);
 *  gigsLogic.test.ts runs both over one document and fails if they part. A comparator,
 *  never an id source. */
export function briefHeadingText(raw: string): string {
  return raw
    .replace(/\\([\\*`<#.\-[\]])/g, "$1")
    .replace(/\*\*|`/g, "")
    .trim();
}

/** The brief's heading ids for Markdown.tsx's `headingId` hook. The ids are the ones the
 *  server minted with ONE assigner when it wrote the brief (`brief.sections`); nothing is
 *  re-slugged here. Pure in its argument (React may render twice): the heading's position
 *  picks its section, and a heading whose level or text does not match that section gets
 *  NO id rather than a guessed one. kp's brief has no level-1 heading, so positions align;
 *  a document that ever carries one degrades to unaddressed headings, not wrong ones. */
export function briefHeadingResolver(sections: readonly GigBriefSection[]): (h: { index: number; level: 1 | 2 | 3; text: string }) => string | undefined {
  return (h) => {
    const s = sections[h.index];
    if (!s || s.level !== h.level || s.text !== briefHeadingText(h.text)) return undefined;
    return s.id;
  };
}

/** The part of the `gig_scan` task result a source card reads (gigs/scan.ts
 *  GigScanSummary, restated narrowly: that module reaches the stores). */
export type ScanRunResult = {
  sourceId: string | null;
  notRunnable: number;
  aborted: boolean;
  sources: { sourceId: string; outcome: GigSourceRunOutcome; reason: string | null; created: number; found: number }[];
};

export type SourceScanView =
  | { kind: "ran"; outcome: GigSourceRunOutcome; reason: string | null; created: number; found: number }
  | { kind: "not_run" }
  | { kind: "unknown" };

/** What one source's scan did, read off the task's result: its own run line, "not run"
 *  when a pause landed between the enqueue and the run, or unknown when the result is
 *  unreadable (never a made-up "0 new"). */
export function sourceScanView(result: unknown, sourceId: string): SourceScanView {
  if (!result || typeof result !== "object" || !Array.isArray((result as ScanRunResult).sources)) return { kind: "unknown" };
  const r = result as ScanRunResult;
  const line = r.sources.find((s) => s && s.sourceId === sourceId);
  if (line) return { kind: "ran", outcome: line.outcome, reason: line.reason ?? null, created: Number(line.created) || 0, found: Number(line.found) || 0 };
  if (r.notRunnable > 0) return { kind: "not_run" };
  return { kind: "unknown" };
}

/** `/` search: title, org, id, niche and tags. Matches stay lit; the rest dim. */
export function matchesSearch(gig: Gig, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [gig.title, gig.org ?? "", gig.id, gig.niche ?? "", ...gig.tags].join(" ").toLowerCase().includes(q);
}

// ---------------------------------------------------------------------------
// The rate - a fraction first, a percentage only beside its n
// ---------------------------------------------------------------------------

export type RateView = {
  measured: boolean;
  accepted: number;
  resolved: number;
  pending: number;
  /** Whole percent; null while unmeasured (never 0%). */
  percent: number | null;
  small: boolean;
};

export function rateView(cell: GigKpiCell | null | undefined): RateView {
  if (!cell) return { measured: false, accepted: 0, resolved: 0, pending: 0, percent: null, small: true };
  const measured = cell.resolved > 0 && cell.rate !== null;
  return {
    measured,
    accepted: cell.accepted,
    resolved: cell.resolved,
    pending: cell.pending,
    percent: measured ? Math.round((cell.rate as number) * 100) : null,
    small: cell.smallSample,
  };
}

/** The whole desk's cell: every sent attempt belongs to exactly one gig, and every gig
 *  to exactly one arena, so the arena cells partition it and add up honestly. */
export function overallCell(kpi: Pick<GigKpi, "byArena">): GigKpiCell {
  let resolved = 0;
  let accepted = 0;
  let pending = 0;
  let costUnreported = 0;
  for (const a of GIG_ARENAS) {
    const c = kpi.byArena[a];
    if (!c) continue;
    resolved += c.resolved;
    accepted += c.accepted;
    pending += c.pending;
    costUnreported += c.costUnreported;
  }
  return {
    resolved,
    accepted,
    pending,
    rate: resolved === 0 ? null : accepted / resolved,
    costPerAcceptedUsd: null,
    costUnreported,
    smallSample: resolved < 10,
  };
}

/** The qualification bar, as qualify.ts QUALIFY_THRESHOLD states it. Restated rather
 *  than imported because qualify.ts reaches the store; gigsLogic.test.ts reads the
 *  source and fails if the two disagree. */
export const QUALIFY_BAR = 50;

// ---------------------------------------------------------------------------
// Facts about one gig
// ---------------------------------------------------------------------------

export type DeadlineView = { state: "none" } | { state: "passed" | "soon" | "open"; days: number; at: string };

const DAY_MS = 86_400_000;

export function deadlineView(deadlineAt: string | null, now: Date): DeadlineView {
  if (!deadlineAt) return { state: "none" };
  const t = Date.parse(deadlineAt);
  if (!Number.isFinite(t)) return { state: "none" };
  const days = Math.floor((t - now.getTime()) / DAY_MS);
  if (t < now.getTime()) return { state: "passed", days, at: deadlineAt };
  return { state: days <= 3 ? "soon" : "open", days, at: deadlineAt };
}

export type EvidenceState = "passed" | "failed" | "unverified";

/** Three states, never two: `passed: null` ran with no pass/fail meaning, which is
 *  not a failure and must not be painted as one. */
export function evidenceState(passed: boolean | null): EvidenceState {
  return passed === true ? "passed" : passed === false ? "failed" : "unverified";
}

export function checklistFor(arena: GigArena): readonly string[] {
  return GIG_CHECKLISTS[arena] ?? [GIG_DISCLOSURE_ITEM];
}

// ---------------------------------------------------------------------------
// The desk's Approve / Mark sent gate
// ---------------------------------------------------------------------------

export type DeskGate = {
  ticked: number;
  total: number;
  blockers: number;
  unseenWarns: number;
  /** Approve can be pressed. */
  ready: boolean;
  /** The first unmet condition, for the button label; null when ready. */
  reason: { kind: "blockers"; count: number } | { kind: "checklist"; ticked: number; total: number } | { kind: "unseen"; count: number } | null;
};

export function deskGate(
  items: readonly string[],
  ticks: Readonly<Record<string, boolean>>,
  findings: readonly DraftLintFinding[],
  seen: ReadonlySet<string>
): DeskGate {
  const ticked = items.filter((k) => ticks[k] === true).length;
  const total = items.length;
  const { blockers, unseenWarns } = lintGate(findings, seen);
  const reason: DeskGate["reason"] =
    blockers > 0
      ? { kind: "blockers", count: blockers }
      : ticked < total
        ? { kind: "checklist", ticked, total }
        : unseenWarns > 0
          ? { kind: "unseen", count: unseenWarns }
          : null;
  return { ticked, total, blockers, unseenWarns, ready: reason === null, reason };
}

/** Mark sent needs the checklist complete (the server refuses without the disclosure
 *  tick; the desk asks for all of them, as it did at approve). */
export function markSentGate(items: readonly string[], ticks: Readonly<Record<string, boolean>>): { ticked: number; total: number; ready: boolean } {
  const ticked = items.filter((k) => ticks[k] === true).length;
  return { ticked, total: items.length, ready: ticked === items.length };
}

// ---------------------------------------------------------------------------
// Untrusted text: make the invisible visible
// ---------------------------------------------------------------------------

const INVISIBLE = /[​-‏⁠-⁤﻿᠎‪-‮]/u;

export type TextSegment = { kind: "text"; text: string } | { kind: "invisible"; code: string };

/** A stranger's text split so every zero-width or direction-control character renders
 *  as a visible marker instead of vanishing. */
export function revealInvisible(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let buf = "";
  for (const ch of text) {
    if (INVISIBLE.test(ch)) {
      if (buf) out.push({ kind: "text", text: buf });
      buf = "";
      out.push({ kind: "invisible", code: `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}` });
    } else buf += ch;
  }
  if (buf) out.push({ kind: "text", text: buf });
  return out;
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

/** A keystroke meant for a field, not for the desk's shortcuts. A checkbox is not a
 *  field: 1-6 must still tick with focus on one. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: string; type?: string; isContentEditable?: boolean };
  const tag = (el.tagName ?? "").toLowerCase();
  if (el.isContentEditable) return true;
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") return !["checkbox", "radio", "button", "submit"].includes((el.type ?? "").toLowerCase());
  return false;
}

/** The checklist item a digit key toggles, or null. */
export function checklistKeyFor(key: string, items: readonly string[]): string | null {
  if (!/^[1-9]$/.test(key)) return null;
  return items[Number(key) - 1] ?? null;
}
