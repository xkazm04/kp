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

import type { Entry, PipelineEvent } from "@/app/features/shared/pipelineTypes";
import { slaForStage } from "@/app/features/shared/pipelineTypes";
import { DEFAULT_STAGE_AXIS, stageHasRole, type StageDef } from "@/app/_lib/pipeline-stages";
import { canonicalScoreOf, provenanceOf } from "@/app/_lib/match-score";

const DAY_MS = 86_400_000;

/** The DERIVED aging verdict the board renders for one entry (amber dot + the
 *  staleCount stat): 1 when the card has sat in its stage past the stage SLA, else 0.
 *  Hired never ages; an unparseable timestamp reads fresh. Pure over (entry,
 *  overrides, now) — and deliberately time-injectable: folding THIS into the board
 *  signature is what makes a candidate crossing its SLA purely by the passage of
 *  time flip the signature (→ re-render) on the very next poll, with NO data change.
 *  Kept in lock-step with PipelineTab's `isStale` (same threshold, same fields) —
 *  which means resolving "is this the end of the road" by stage ROLE on the
 *  workspace's own axis, not by the name "Hired". A board whose terminal column is
 *  called anything else used to age every hired candidate here (and the aging quick
 *  filter, which routes through this function, then listed them) while the stat
 *  chip beside it counted correctly: one number, two answers. */
export function agingBucket(
  e: Entry,
  overrides: Record<string, number> | null | undefined,
  now: number,
  axis: readonly StageDef[] = DEFAULT_STAGE_AXIS
): 0 | 1 {
  if (stageHasRole(e.stage, "terminal", axis)) return 0;
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

// Identity cache for the per-entry TIME-INDEPENDENT signature (Direction 3). The
// JSON.stringify of the 11-field tuple is the diet's hot bookkeeping: it was
// recomputed for BOTH prev and next props on every parent render — including every
// search keystroke — for every card in every cell. Here it is memoized on the entry
// OBJECT: an entry is treated as IMMUTABLE (the load path parses fresh objects from
// JSON, and every optimistic update spreads a new object — see PipelineTab's
// setEntries(cur.map(e => e.id === id ? { ...e, stage } : e))), so object identity ⟺
// rendered content and the cache can key on identity. New objects arrive ONLY when a
// fetch produced new data (or an optimistic edit); BETWEEN those, the `entries` state
// holds stable references, so a keystroke-driven re-render does ZERO JSON work for
// unchanged entries — it just reads the cached string.
//
// The time-varying half (the aging bucket) is deliberately OUTSIDE this cache: it's
// cheap arithmetic recomputed per call and concatenated on, so a bucket flip can't be
// masked by a stale cache entry, while the expensive JSON stays memoized.
const entrySigCache = new WeakMap<Entry, string>();

/** The render-affecting fields of one board entry, as a compact string. Anything a
 *  CandidateRow can show — identity, label, archetype, stage, the CANONICAL score +
 *  its provenance (what the badge/tooltip render, not the raw snapshot), the
 *  work-sample transfer score the badge falls back to, stage age,
 *  approval state, and the intake-degraded state — flips this; nothing else does.
 *  Identity-cached: computed once per entry object (see entrySigCache). */
export function entrySignature(e: Entry): string {
  const cached = entrySigCache.get(e);
  if (cached !== undefined) return cached;
  const sig = JSON.stringify([
    e.id,
    e.candidateLabel,
    e.archetype,
    e.stage,
    e.status,
    canonicalScoreOf(e),
    provenanceOf(e),
    // ONE THREAD (gap 2): the row renders the transfer score when there is no match
    // score, so a change to it must flip the signature too — otherwise a work-sample
    // re-evaluation would leave a stale number on a memoized card.
    e.transferScore ?? null,
    e.stageChangedAt,
    e.approvalKind,
    e.intakeDegraded ? 1 : 0,
    e.intakeDegradedReason ?? null,
  ]);
  entrySigCache.set(e, sig);
  return sig;
}

// Field/record separators for the concat-joined signatures below. Both are control
// chars (< 0x20); JSON.stringify ALWAYS escapes them (\t, \n) inside strings, so a
// literal byte can never appear in an entrySignature — the join is unambiguous
// without a second JSON.stringify pass over the array (Direction 3: cheap concat of
// the cached per-entry strings, not a re-stringify on every render).
const FIELD_SEP = "\t";
const REC_SEP = "\n";

/** Content signature of the whole board payload — order-sensitive, since the lane
 *  layout is order-derived. Two polls with byte-identical rendered content produce
 *  the SAME signature even though the arrays are distinct objects.
 *
 *  Each entry contributes its cached content signature PLUS its DERIVED aging bucket,
 *  so a candidate crossing its SLA purely by the clock — no data change — flips this
 *  signature on the next poll and re-renders the affected rows (the amber dot +
 *  staleCount). `now` is injectable for tests; `overrides` are the recruiter's
 *  per-board SLA overrides so the gate agrees with `isStale`. */
export function boardSignature(
  entries: readonly Entry[],
  opts?: { overrides?: Record<string, number> | null; now?: number; axis?: readonly StageDef[] }
): string {
  const now = opts?.now ?? Date.now();
  const overrides = opts?.overrides ?? null;
  const axis = opts?.axis ?? DEFAULT_STAGE_AXIS;
  let s = "";
  for (const e of entries) s += entrySignature(e) + FIELD_SEP + agingBucket(e, overrides, now, axis) + REC_SEP;
  return s;
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
  // Cheap concat of the CACHED per-entry strings (Direction 3) — no second
  // JSON.stringify over the array. On a keystroke-driven parent render the entry
  // objects are stable, so entrySignature is a WeakMap hit and this does zero JSON
  // work; only the stale/selected flags are folded fresh (they live outside the
  // entry object). Control-char separators keep the join collision-free.
  let s = "";
  for (const e of entries) {
    s += entrySignature(e) + FIELD_SEP + (isStale(e) ? 1 : 0) + FIELD_SEP + (selectedIds.has(e.id) ? 1 : 0) + REC_SEP;
  }
  return s;
}
