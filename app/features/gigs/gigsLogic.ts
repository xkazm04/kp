import { GIG_CHECKLISTS } from "@/app/_lib/gigs/checklists";
import { lintGate, type DraftLintFinding } from "@/app/_lib/gigs/draft-lint";
import {
  GIG_ARENAS,
  GIG_DISCLOSURE_ITEM,
  type Gig,
  type GigArena,
  type GigAttempt,
  type GigKpi,
  type GigKpiCell,
  type GigSource,
  type GigSpecialist,
  type GigStatus,
} from "@/app/_lib/gigs/types";

// Pure derivations for the Gigs tab: what needs the operator's judgement, the line (the
// wall of arenas by lifecycle step), the rate as a fraction, and the desk's Approve gate.
// No React, no fetch, the clock passed in - pinned by gigsLogic.test.ts.

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

function ageKey(item: QueueItem): string {
  const a = item.attempt;
  if (item.kind === "record") return a?.sentAt ?? a?.updatedAt ?? item.gig.updatedAt;
  if (a && (item.kind === "review" || item.kind === "running" || item.kind === "revision" || item.kind === "failed")) return a.createdAt;
  return item.gig.createdAt;
}

/** Every open item, grouped in QUEUE_KINDS order, oldest first within a group. */
export function deriveQueue(gigs: readonly Gig[], attemptsByGig: Readonly<Record<string, GigAttempt>>): QueueItem[] {
  const items: QueueItem[] = [];
  for (const gig of gigs) {
    const latest = attemptsByGig[gig.id] ?? null;
    const kind = queueKindOf(gig, latest);
    if (!kind) continue;
    items.push({ kind, key: `${kind}:${gig.id}`, gig, attempt: latest });
  }
  const rank = (k: QueueKind) => QUEUE_KINDS.indexOf(k);
  return items.sort((a, b) => rank(a.kind) - rank(b.kind) || (ageKey(a) < ageKey(b) ? -1 : ageKey(a) > ageKey(b) ? 1 : 0) || (a.gig.id < b.gig.id ? -1 : 1));
}

export function queueCounts(items: readonly QueueItem[]): Record<QueueKind, number> {
  const out = Object.fromEntries(QUEUE_KINDS.map((k) => [k, 0])) as Record<QueueKind, number>;
  for (const i of items) out[i.kind] += 1;
  return out;
}

/** `N`: the next judgement after the one last opened, oldest first within its kind,
 *  wrapping round; the first one when nothing was opened yet; null when none is owed. */
export function nextNeed(items: readonly QueueItem[], lastGigId: string | null, only?: NeedKind): QueueItem | null {
  const needs = items.filter((i) => (only ? i.kind === only : (NEED_KINDS as readonly string[]).includes(i.kind)));
  if (needs.length === 0) return null;
  if (only) return needs[0];
  const at = lastGigId ? needs.findIndex((i) => i.gig.id === lastGigId) : -1;
  return needs[(at + 1) % needs.length];
}

// ---------------------------------------------------------------------------
// The line: arenas are rows, the lifecycle steps are columns
// ---------------------------------------------------------------------------

/** The canonical steps, left to right. The three ways off the line are grouped in one
 *  column after them ("Left the line"), then each arena's terminus. */
export const LINE_STEPS = ["new", "suspect", "qualified", "dispatched", "drafted", "in_review", "sent", "accepted", "rejected"] as const satisfies readonly GigStatus[];
export type LineStep = (typeof LINE_STEPS)[number];
export const OFF_STEPS = ["declined", "withdrawn", "expired"] as const satisfies readonly GigStatus[];
export type OffStep = (typeof OFF_STEPS)[number];

/** Who owns the next move at a step. `you` is a judgement - the three columns that
 *  carry the "your judgement" band; the others name their owner in words. */
export type StepOwner = "you" | "scan" | "dispatch" | "agent" | "send" | "judge";
export const STEP_OWNER: Readonly<Record<LineStep, StepOwner>> = {
  new: "scan",
  suspect: "you",
  qualified: "dispatch",
  dispatched: "agent",
  drafted: "you",
  in_review: "send",
  sent: "you",
  accepted: "judge",
  rejected: "judge",
};

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

/** Whether any gig of this arena ever reached `step`. An empty cell of a step the arena
 *  reached says "none here now"; one it never reached says "none reached" - the two are
 *  different facts and never render alike. */
export function reachedStep(gigs: readonly Gig[], attemptsByGig: Readonly<Record<string, GigAttempt>>, step: LineStep): boolean {
  if (step === "suspect") return gigs.some((g) => g.status === "suspect" || g.suspectReasons.length > 0);
  if (step === "accepted" || step === "rejected") return gigs.some((g) => g.status === step);
  const need = FLOW_RANK[step]!;
  return gigs.some((g) => furthestRank(g, attemptsByGig[g.id] ?? null) >= need);
}

export type LineCell = { step: LineStep; gigs: Gig[]; reached: boolean };
export type LineRow = { arena: GigArena; total: number; cells: LineCell[]; off: { step: OffStep; gigs: Gig[] }[] };

/** Oldest waiting first: the latest attempt's start, else when the gig last moved. */
function waitingSince(gig: Gig, latest: GigAttempt | null): string {
  return latest?.createdAt ?? gig.updatedAt;
}

/** The whole wall: one row per arena (all four, an empty one included), each cell's
 *  gigs oldest-waiting first. */
export function lineRows(gigs: readonly Gig[], attemptsByGig: Readonly<Record<string, GigAttempt>>): LineRow[] {
  return GIG_ARENAS.map((arena) => {
    const mine = gigs
      .filter((g) => g.arena === arena)
      .sort((a, b) => {
        const x = waitingSince(a, attemptsByGig[a.id] ?? null);
        const y = waitingSince(b, attemptsByGig[b.id] ?? null);
        return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : 1;
      });
    return {
      arena,
      total: mine.length,
      cells: LINE_STEPS.map((step) => ({ step, gigs: mine.filter((g) => g.status === step), reached: reachedStep(mine, attemptsByGig, step) })),
      off: OFF_STEPS.map((step) => ({ step, gigs: mine.filter((g) => g.status === step) })),
    };
  });
}

/** `/` search: title, org, id, niche and tags. Matches stay lit; the rest dim. */
export function matchesSearch(gig: Gig, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return [gig.title, gig.org ?? "", gig.id, gig.niche ?? "", ...gig.tags].join(" ").toLowerCase().includes(q);
}

/** Whether a gig is owed one of the three judgements right now. */
export function needsYou(gig: Gig, latest: GigAttempt | null): boolean {
  const kind = queueKindOf(gig, latest);
  return kind !== null && (NEED_KINDS as readonly string[]).includes(kind);
}

/** How many cards a cell shows before "show N more". */
export const CELL_CAP = 6;

/** A specialist's stable place in the edge vocabulary: its rank by hire date, so one
 *  specialist keeps its edge across reloads and screens. */
export function specialistEdgeIndex(specialists: readonly Pick<GigSpecialist, "id" | "createdAt">[], id: string): number {
  const order = [...specialists].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  return order.findIndex((s) => s.id === id);
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

/** Margin marks: line-anchored findings grouped by line (1-based). */
export function marksByLine(findings: readonly DraftLintFinding[]): Map<number, DraftLintFinding[]> {
  const out = new Map<number, DraftLintFinding[]>();
  for (const f of findings) {
    if (f.line === null) continue;
    const list = out.get(f.line) ?? [];
    list.push(f);
    out.set(f.line, list);
  }
  return out;
}

/** Split a line around the first occurrence of `excerpt` for underlining. */
export function splitAround(line: string, excerpt: string | undefined): [string, string, string] | null {
  if (!excerpt) return null;
  const at = line.indexOf(excerpt);
  if (at < 0) return null;
  return [line.slice(0, at), excerpt, line.slice(at + excerpt.length)];
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
