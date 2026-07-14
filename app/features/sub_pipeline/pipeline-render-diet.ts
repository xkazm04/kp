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
import { canonicalScoreOf, provenanceOf } from "@/app/_lib/match-score";

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
 *  the SAME signature even though the arrays are distinct objects. */
export function boardSignature(entries: readonly Entry[]): string {
  return JSON.stringify(entries.map(entrySignature));
}

/** The render-affecting fields of one activity-feed event. */
export function eventSignature(ev: PipelineEvent): string {
  return JSON.stringify([ev.id, ev.kind, ev.candidateLabel, ev.jobTitle, ev.toStage, ev.detail, ev.createdAt]);
}

/** Content signature of the events list (the initial feed page). */
export function eventsSignature(events: readonly PipelineEvent[]): string {
  return JSON.stringify(events.map(eventSignature));
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
