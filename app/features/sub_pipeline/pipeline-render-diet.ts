// Poll-tick render diet (perfect-board). The board polls /api/pipeline every 30s
// and, before this, did an UNCONDITIONAL setEntries(fresh array) on every tick —
// so a no-change poll still gave every entry a new object identity, recomputing
// bucketLaneEntries and reconciling every StageCell/CandidateRow.
//
// Two pure primitives fix that, both unit-pinned:
//   1. A cheap content SIGNATURE over the payload, compared before setEntries —
//      an identical poll is a no-op (no state set → no render at all).
//   2. Field-level equality predicates for React.memo on CandidateRow/StageCell —
//      when the board DOES change, only the cards whose rendered content actually
//      changed re-render, instead of the whole board reconciling because the array
//      is a fresh reference.
//
// The signature covers EXACTLY the fields these surfaces render, so it can neither
// miss a visible change (stale board) nor trip on an invisible one (needless
// render). Signatures are JSON-encoded field tuples: JSON escaping makes them
// unambiguous (no separator a label could contain) and keeps the file plain text.

import type { Entry, PipelineEvent } from "./PipelineTypes";
import { slaForStage } from "./PipelineTypes";
import { canonicalScoreOf, provenanceOf } from "@/app/_lib/match-score";

const DAY_MS = 86_400_000;

/** The DERIVED aging verdict the board renders for one entry (amber dot + the
 *  staleCount stat): 1 when the card has sat in its stage past the stage SLA, else 0.
 *  Hired never ages; an unparseable timestamp reads fresh. Pure over (entry,
 *  overrides, now) — and deliberately time-injectable: folding THIS into the board
 *  signature is what makes a candidate crossing its SLA purely by the passage of
 *  time flip the signature (→ re-render) on the very next poll, with NO data change.
 *  Kept in lock-step with PipelineTab's `isStale` (same threshold, same fields). */
export function agingBucket(e: Entry, overrides: Record<string, number> | null | undefined, now: number): 0 | 1 {
  if (e.stage === "Hired") return 0;
  const changed = e.stageChangedAt ? Date.parse(e.stageChangedAt) : NaN;
  if (!Number.isFinite(changed)) return 0;
  const days = Math.floor((now - changed) / DAY_MS);
  return days >= slaForStage(e.stage, overrides) ? 1 : 0;
}

/** Day-bucketed relative-time class for an ISO instant at `now` — EXACTLY the cut
 *  points useRelativeTime renders (today / yesterday / Nd / Nw / Nmo). This is the
 *  ONE source of those cut points: useRelativeTime maps this to localized copy, and
 *  eventSignature folds it, so the feed's rendered "2d"→"3d" transition changes the
 *  signature on a quiet board while sub-day drift never churns it. */
export type RelTimeBucket =
  | { unit: "none" }
  | { unit: "today" }
  | { unit: "yesterday" }
  | { unit: "day"; n: number }
  | { unit: "week"; n: number }
  | { unit: "month"; n: number };

export function relativeTimeBucket(iso: string | null, now: number = Date.now()): RelTimeBucket {
  if (!iso) return { unit: "none" };
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { unit: "none" };
  const d = Math.floor((now - t) / DAY_MS);
  if (d <= 0) return { unit: "today" };
  if (d === 1) return { unit: "yesterday" };
  if (d < 7) return { unit: "day", n: d };
  if (d < 30) return { unit: "week", n: Math.floor(d / 7) };
  return { unit: "month", n: Math.floor(d / 30) };
}

/** Stable string form of the relative-time bucket, for signature folding. */
export function relativeTimeBucketKey(iso: string | null, now: number = Date.now()): string {
  const b = relativeTimeBucket(iso, now);
  return b.unit === "day" || b.unit === "week" || b.unit === "month" ? `${b.unit}:${b.n}` : b.unit;
}

/** The render-affecting fields of one board entry, as a compact string. Anything a
 *  CandidateRow can show — identity, label, archetype, stage, the CANONICAL score +
 *  its provenance (what the badge/tooltip render, not the raw snapshot), stage age,
 *  approval state, and the intake-degraded state — flips this; nothing else does. */
export function entrySignature(e: Entry): string {
  return JSON.stringify([
    e.id,
    e.candidateLabel,
    e.archetype,
    e.stage,
    e.status,
    canonicalScoreOf(e),
    provenanceOf(e),
    e.stageChangedAt,
    e.approvalKind,
    e.intakeDegraded ? 1 : 0,
    e.intakeDegradedReason ?? null,
  ]);
}

/** Content signature of the whole board payload — order-sensitive, since the lane
 *  layout is order-derived. Two polls with byte-identical rendered content produce
 *  the SAME signature even though the arrays are distinct objects.
 *
 *  Each entry contributes its rendered content (entrySignature) PLUS its DERIVED
 *  aging bucket, so a candidate crossing its SLA purely by the clock — no data
 *  change — flips this signature on the next poll and re-renders the affected rows
 *  (the amber dot + staleCount). `now` is injectable for tests; `overrides` are the
 *  recruiter's per-board SLA overrides so the gate agrees with `isStale`. */
export function boardSignature(
  entries: readonly Entry[],
  opts?: { overrides?: Record<string, number> | null; now?: number }
): string {
  const now = opts?.now ?? Date.now();
  const overrides = opts?.overrides ?? null;
  return JSON.stringify(entries.map((e) => [entrySignature(e), agingBucket(e, overrides, now)]));
}

/** The render-affecting fields of one activity-feed event, INCLUDING its rendered
 *  relative-time bucket, so a "2d"→"3d" transition changes the signature even with
 *  no new event. `now` injectable for tests. */
export function eventSignature(ev: PipelineEvent, now: number = Date.now()): string {
  return JSON.stringify([
    ev.id,
    ev.kind,
    ev.candidateLabel,
    ev.jobTitle,
    ev.toStage,
    ev.detail,
    ev.createdAt,
    relativeTimeBucketKey(ev.createdAt, now),
  ]);
}

/** Content signature of the events list (the initial feed page). */
export function eventsSignature(events: readonly PipelineEvent[], now: number = Date.now()): string {
  return JSON.stringify(events.map((ev) => eventSignature(ev, now)));
}

/** React.memo equality for a CandidateRow: re-render only when the entry's rendered
 *  content OR one of the presentational flags changed. The handler props are
 *  intentionally excluded — their behavior is fully determined by `entry` (compared
 *  here) and the stable board state they close over, so a fresh closure per render
 *  must not by itself force a reconcile. Presence of the optional action/move
 *  handlers IS compared, since it toggles affordances. */
export function candidateRowEqual(
  prev: {
    entry: Entry;
    pending?: boolean;
    stale?: boolean;
    selectMode?: boolean;
    selected?: boolean;
    draggable?: boolean;
    onActions?: unknown;
    onMove?: unknown;
  },
  next: typeof prev
): boolean {
  return (
    prev.pending === next.pending &&
    prev.stale === next.stale &&
    prev.selectMode === next.selectMode &&
    prev.selected === next.selected &&
    prev.draggable === next.draggable &&
    !!prev.onActions === !!next.onActions &&
    !!prev.onMove === !!next.onMove &&
    entrySignature(prev.entry) === entrySignature(next.entry)
  );
}

/** The full per-cell signature StageCell memoizes on: each entry's content PLUS its
 *  stale verdict and selected state (both of which the cell renders but which live
 *  outside the entry object). Evaluating `isStale`/`selectedIds` here means an SLA
 *  override or a selection toggle correctly re-renders the affected cell even though
 *  the entry data itself is unchanged. */
export function stageCellSignature(
  entries: readonly Entry[],
  isStale: (e: Entry) => boolean,
  selectedIds: ReadonlySet<string>
): string {
  return JSON.stringify(entries.map((e) => [entrySignature(e), isStale(e) ? 1 : 0, selectedIds.has(e.id) ? 1 : 0]));
}
