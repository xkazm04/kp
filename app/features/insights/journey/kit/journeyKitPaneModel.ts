/*
 * The reading pane's pure half for one journey (kit lane board, Gate 3): the role's own kind rail
 * against this candidate (present / skipped / never reached, the three facts railCells keeps
 * apart), and the trail in time order with its silences and clock jumps left in place.
 *
 * Pure and JSX-free, so node:test reaches it.
 */
import type { JourneyColumn, JourneyEvent, JourneyPhaseId, JourneyRailStep } from "@/app/_lib/journey/types";
import { JOURNEY_PHASE_IDS } from "@/app/_lib/journey/types";
import type { ShapeKind } from "../../../../_components/kit/types.ts";
import { alignEventsToRail, lastReachedRailIndex } from "../railCells.ts";
import { normalizeAbsenceKey, SILENCE_DAYS } from "../journeyLayout.ts";
import { reachedShape } from "./journeyKitSteps.ts";

const DAY = 86_400_000;

/** A gap this long is not a quiet spell, it is a clock that jumped: a seeded or backfilled date
 *  sitting years before the rest of the record. It gets its own words ("check this date"), the
 *  distinction the contest's Broadsheet prototype drew and the shipped board never ported. */
export const CLOCK_JUMP_DAYS = 365;

export type PaneStep = {
  rail: JourneyRailStep;
  shape: ShapeKind;
  state: "present" | "skipped" | "never-reached";
  events: JourneyEvent[];
};

/** The role's kind rail (RoleCluster.rail) against one column, one line per rung. */
export function paneSteps(rail: readonly JourneyRailStep[], column: Pick<JourneyColumn, "events" | "origin">): PaneStep[] {
  const ordered = [...rail].sort((a, b) => a.index - b.index);
  const { placedAt, occupied } = alignEventsToRail(column.events, ordered);
  // Positions, not rung indexes: alignEventsToRail answers in the order it was given.
  const last = lastReachedRailIndex(occupied);
  const byRung = new Map<number, JourneyEvent[]>();
  placedAt.forEach((pos, i) => {
    if (pos < 0) return;
    const list = byRung.get(pos);
    if (list) list.push(column.events[i]);
    else byRung.set(pos, [column.events[i]]);
  });
  return ordered.map((rung, pos) => {
    const events = byRung.get(pos) ?? [];
    if (events.length) return { rail: rung, shape: reachedShape(events, column), state: "present", events };
    return { rail: rung, shape: "none", state: pos < last ? "skipped" : "never-reached", events };
  });
}

export type TrailRow =
  | { key: string; kind: "event"; event: JourneyEvent }
  | { key: string; kind: "silence"; days: number; untilToday: boolean }
  | { key: string; kind: "jump"; years: number }
  | { key: string; kind: "phase"; phase: JourneyPhaseId; reasonKey: string | null };

/**
 * The trail: first, each phase that did not happen (with its reason, or null = "never recorded,
 * no reason on file"); then the events in order, a silence row wherever SILENCE_DAYS or more
 * passed, a clock-jump row where a year or more did, and for a journey still under way the
 * silence up to today.
 */
export function trailRows(
  column: Pick<JourneyColumn, "events" | "phases">,
  opts: { hasKey: (key: string) => boolean; underWay: boolean; now: number; keep?: (e: JourneyEvent) => boolean }
): TrailRow[] {
  const rows: TrailRow[] = [];
  for (const phase of JOURNEY_PHASE_IDS) {
    const state = column.phases[phase];
    if (!state || state.present) continue;
    const key = normalizeAbsenceKey(state.absenceReasonKey);
    rows.push({ key: `phase:${phase}`, kind: "phase", phase, reasonKey: opts.hasKey(key) ? key : null });
  }
  const events = opts.keep ? column.events.filter(opts.keep) : column.events;
  let prev: JourneyEvent | null = null;
  for (const event of events) {
    if (prev) {
      const gap = gapDays(prev.occurredAt, event.occurredAt);
      if (gap >= CLOCK_JUMP_DAYS) rows.push({ key: `jump:${event.id}`, kind: "jump", years: Math.round((gap / 365) * 10) / 10 });
      else if (gap >= SILENCE_DAYS) rows.push({ key: `quiet:${event.id}`, kind: "silence", days: gap, untilToday: false });
    }
    rows.push({ key: event.id, kind: "event", event });
    prev = event;
  }
  if (prev && opts.underWay) {
    const gap = Math.floor((opts.now - Date.parse(prev.occurredAt)) / DAY);
    if (gap >= SILENCE_DAYS) rows.push({ key: "quiet:today", kind: "silence", days: gap, untilToday: true });
  }
  return rows;
}

/** Whole days from a to b; 0 when either date is unreadable or b is not later. */
export function gapDays(a: string, b: string): number {
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || y <= x) return 0;
  return Math.floor((y - x) / DAY);
}
