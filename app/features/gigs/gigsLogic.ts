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

// Pure derivations for the Gigs tab: what needs the operator's judgement, the board's
// lifecycle grouping, the rate as a fraction, and the desk's Approve gate. No React, no
// fetch, the clock passed in - pinned by gigsLogic.test.ts.

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

/** What a view calls after a write: `left` = the item left the queue it was in, `flash`
 *  = one sentence for the queue's status line. Answers the re-read KPI. */
export type AfterWrite = (left: boolean, flash?: string | null) => Promise<GigKpi | null>;

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
// The judgement queue
// ---------------------------------------------------------------------------

/** Operator-owned kinds first (they are the four count tiles), then the kinds that sit
 *  with the agents and never pad the operator's count. */
export const OPERATOR_KINDS = ["review", "suspect", "record", "triage"] as const;
export const AGENT_KINDS = ["running", "revision", "failed"] as const;
export const QUEUE_KINDS = [...OPERATOR_KINDS, ...AGENT_KINDS] as const;
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

/** J/K movement through the visible items; clamps at both ends, starts at the first. */
export function stepSelection(items: readonly QueueItem[], current: string | null, dir: 1 | -1): string | null {
  if (items.length === 0) return null;
  const at = current ? items.findIndex((i) => i.key === current) : -1;
  if (at < 0) return items[0].key;
  return items[Math.max(0, Math.min(items.length - 1, at + dir))].key;
}

/** After an action removed `removedKey`, what to open next: the item that took its place
 *  in the same group, else the first operator item, else nothing. */
export function selectionAfter(before: readonly QueueItem[], after: readonly QueueItem[], removedKey: string): string | null {
  if (after.some((i) => i.key === removedKey)) return removedKey;
  const at = before.findIndex((i) => i.key === removedKey);
  const kind = at >= 0 ? before[at].kind : null;
  const sameKind = after.filter((i) => i.kind === kind);
  if (sameKind.length) {
    const laterInBefore = before.slice(at + 1).find((i) => i.kind === kind && after.some((x) => x.key === i.key));
    return laterInBefore ? laterInBefore.key : sameKind[sameKind.length - 1].key;
  }
  const firstOperator = after.find((i) => (OPERATOR_KINDS as readonly string[]).includes(i.kind));
  return firstOperator ? firstOperator.key : null;
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/** Every lifecycle step, in order, including the three off-ramps - an empty step is
 *  shown, so a step nothing reached reads as a gap rather than a missing row. */
export const BOARD_STEPS: readonly GigStatus[] = [
  "new",
  "suspect",
  "qualified",
  "dispatched",
  "drafted",
  "in_review",
  "sent",
  "accepted",
  "rejected",
  "declined",
  "expired",
  "withdrawn",
];

export type BoardFilter = { search: string; arena: GigArena | "all"; status: GigStatus | "all" };

export function matchesBoardFilter(gig: Gig, f: BoardFilter): boolean {
  if (f.arena !== "all" && gig.arena !== f.arena) return false;
  if (f.status !== "all" && gig.status !== f.status) return false;
  const q = f.search.trim().toLowerCase();
  if (!q) return true;
  return [gig.title, gig.org ?? "", gig.id, gig.niche ?? "", ...gig.tags].join(" ").toLowerCase().includes(q);
}

export function groupBoard(gigs: readonly Gig[], f: BoardFilter): { status: GigStatus; gigs: Gig[] }[] {
  const rows = gigs.filter((g) => matchesBoardFilter(g, f));
  const steps = f.status === "all" ? BOARD_STEPS : BOARD_STEPS.filter((s) => s === f.status);
  return steps.map((status) => ({ status, gigs: rows.filter((g) => g.status === status) }));
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
