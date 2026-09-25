/*
 * The reading pane's pure half for one pipeline entry: its path through the workspace's stages (the
 * column StageRail) and its history trail with the silences left in place. Fed by the entry's own
 * pipeline events from GET /api/pipeline/[id]/timeline (useCandidateBundle, the candidate modal's one
 * request) - the only route that carries an entry's full event history.
 */
import type { ShapeKind } from "../../../../_components/kit/types.ts";
import type { PipelineEvent, StageDef } from "../../../shared/pipelineTypes.ts";

/** Event kinds that record a move INTO their `toStage` (a walk, not a placement). */
export const MOVE_KINDS: ReadonlySet<string> = new Set(["advanced", "moved", "auto_advanced", "scheduled", "offer_accepted", "reinstated"]);

export type PathCell = {
  id: string;
  label: string;
  shape: ShapeKind;
  /** Events whose toStage is this stage. */
  count: number;
  /** The first of them (ISO), for the date column. */
  first: string | null;
  /** Why the cell reads as it does, for the words: a reached step names nothing. */
  reason: "reached" | "hereUnrecorded" | "skipped" | "notReached";
};

/**
 * One cell per axis stage. Reached with a recorded move (or before the current stage) = solid; reached
 * only by a non-move event = ring; the current stage with no event = dashed; earlier unrecorded = a
 * skipped gap; later = not reached.
 */
export function pathCells(axis: readonly StageDef[], stage: string, events: readonly PipelineEvent[]): PathCell[] {
  const at = axis.findIndex((s) => s.id === stage);
  return axis.map((s, i) => {
    const into = events.filter((v) => v.toStage === s.id);
    if (into.length) {
      const walked = into.some((v) => MOVE_KINDS.has(v.kind)) || (at >= 0 && i < at);
      return { id: s.id, label: s.label, shape: walked ? "solid" : "ring", count: into.length, first: into[0].createdAt, reason: "reached" };
    }
    if (i === at) return { id: s.id, label: s.label, shape: "dashed", count: 0, first: null, reason: "hereUnrecorded" };
    return { id: s.id, label: s.label, shape: "none", count: 0, first: null, reason: at >= 0 && i < at ? "skipped" : "notReached" };
  });
}

export type TrailRow = { key: string; kind: "event"; event: PipelineEvent } | { key: string; kind: "silence"; days: number; untilToday?: boolean } | { key: string; kind: "nothing" };

/** A silence this long between two events is shown in place, never collapsed away. */
export const SILENCE_DAYS = 7;
const DAY = 86_400_000;

/** The history in time order, a silence row wherever 7+ days passed, and the silence up to today for a live entry. */
export function historyTrail(events: readonly PipelineEvent[], opts: { live: boolean; now: number }): TrailRow[] {
  if (!events.length) return [{ key: "nothing", kind: "nothing" }];
  const evs = events.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  const rows: TrailRow[] = [];
  evs.forEach((v, i) => {
    if (i > 0) {
      const d = Math.round((Date.parse(v.createdAt) - Date.parse(evs[i - 1].createdAt)) / DAY);
      if (d >= SILENCE_DAYS) rows.push({ key: `gap-${v.id}`, kind: "silence", days: d });
    }
    rows.push({ key: `ev-${v.id}`, kind: "event", event: v });
  });
  if (opts.live) {
    const d = Math.round((opts.now - Date.parse(evs[evs.length - 1].createdAt)) / DAY);
    if (d >= SILENCE_DAYS) rows.push({ key: "gap-today", kind: "silence", days: d, untilToday: true });
  }
  return rows;
}

/** How far along the entry stands: its stage's 1-based position on the axis (0 when stranded off it). */
export function stagePosition(axis: readonly StageDef[], stage: string): number {
  return axis.findIndex((s) => s.id === stage) + 1;
}
