/*
 * The kit lane board's rows and its rail (kit-unification Gate 3). One LaneRow per candidate of the
 * selected role, every one on the same KIT_STEPS columns; the StageRail head counts over them.
 *
 * Liveness (every field a lane shows, and the payload field that fills it):
 *   step reached / provenance   JourneyColumn.events[].kind + .confidence + column.origin
 *                               (GET /api/journeys?role=<jobId>, journeySteps.laneCells)
 *   absence reason              JourneyColumn.phases[phase].absenceReasonKey
 *   match                       JourneyColumn.matchScore (null prints "—", never 0)
 *   last movement / quiet       the last JourneyColumn.events[].occurredAt
 *   status (hired, out, quiet)  JourneyCohortInstance.outcome (GET /api/journeys/cohort), by entry id
 *   waiting on you              an active journey whose last event is a `screening_hold`
 *
 * Pure and JSX-free, so node:test reaches it.
 */
import type { JourneyCohortOutcome, JourneyColumn, JourneyEvent } from "@/app/_lib/journey/types";
import { furthestStep, KIT_STEPS, laneCells, type KitCell, type KitStep, type LaneOptions } from "./journeyKitSteps.ts";
import { columnMatchesFind } from "../journeyFilters.ts";

/** A journey this long without a new event reads as gone quiet: the cohort layer's own threshold
 *  (JOURNEY_STALL_DAYS in app/_lib/journey/project.ts, server-only, so restated here). */
export const QUIET_DAYS = 21;
const DAY = 86_400_000;

export type LaneStatus = "needs" | JourneyCohortOutcome | "empty";

export type LaneRow = {
  column: JourneyColumn;
  cells: KitCell[];
  furthest: number;
  status: LaneStatus;
  last: JourneyEvent | null;
  /** Whole days since the last event, for an open journey; null otherwise. */
  quietDays: number | null;
};

const REJECTS = new Set(["rejected", "auto_rejected", "rejection_sent"]);

/** The status the mark track draws. The cohort's outcome wins; a column the cohort did not scan
 *  (its cap) falls back to what its own events say. */
export function laneStatus(column: JourneyColumn, outcome: JourneyCohortOutcome | undefined): LaneStatus {
  const last = column.events.at(-1);
  if (!last) return "empty";
  if (column.active && last.kind === "screening_hold" && outcome !== "hired") return "needs";
  if (outcome) return outcome;
  if (!column.active) return column.events.some((e) => REJECTS.has(e.kind)) ? "rejected" : "withdrawn";
  return "open";
}

/** A journey that can still be "stopped" at a step: still under way, not decided. */
export const underWay = (s: LaneStatus) => s === "needs" || s === "open" || s === "stalled";

export function laneRow(
  column: JourneyColumn,
  outcome: JourneyCohortOutcome | undefined,
  opts: LaneOptions,
  now: number
): LaneRow {
  const cells = laneCells(column, opts);
  const status = laneStatus(column, outcome);
  const last = column.events.at(-1) ?? null;
  const at = last ? Date.parse(last.occurredAt) : NaN;
  const quietDays = underWay(status) && Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / DAY)) : null;
  return { column, cells, furthest: furthestStep(cells), status, last, quietDays };
}

export type KitRailStep = {
  step: KitStep;
  reached: number;
  of: number;
  stopped: number;
  /** Lanes where an "auto:*" actor took this step. */
  machine: number;
  /** Not null when nobody reached the step and every lane says why: the shared reason key, or
   *  "" when the lanes give different reasons (the head then says "nothing happened here"). */
  absent: string | null;
};

/** The rail over a role's lanes: "N of M" reached, "N stop here", a step nobody could reach. */
export function railSteps(lanes: readonly LaneRow[]): KitRailStep[] {
  return KIT_STEPS.map((step, i) => {
    let reached = 0;
    let stopped = 0;
    let machine = 0;
    const reasons = new Set<string>();
    let allAbsent = lanes.length > 0;
    for (const lane of lanes) {
      const cell = lane.cells[i];
      if (cell.reason === "reached") reached += 1;
      if (cell.machine) machine += 1;
      if (lane.furthest === i && underWay(lane.status)) stopped += 1;
      if (cell.reason === "absent" && cell.absenceKey) reasons.add(cell.absenceKey);
      else allAbsent = false;
    }
    const absent = reached === 0 && allAbsent ? (reasons.size === 1 ? [...reasons][0] : "") : null;
    return { step, reached, of: lanes.length, stopped, machine, absent };
  });
}

export type LaneFilters = {
  activeOnly: boolean;
  testRuns: boolean;
  find: string;
  /** Show only the journeys under way whose furthest step is this one. */
  stop: KitStep | null;
};

export const NO_LANE_FILTERS: LaneFilters = { activeOnly: false, testRuns: false, find: "", stop: null };

/** The role's cohort, as the rail counts it: test runs only when asked for (a /uat run must never
 *  read as live traffic). Find, active-only and the stop filter narrow the LIST, never the rail's
 *  "N of M", the same rule useJourneyBoard keeps for the Broadsheet's rail. */
export function railCohort(lanes: readonly LaneRow[], f: Pick<LaneFilters, "testRuns">): LaneRow[] {
  return f.testRuns ? [...lanes] : lanes.filter((l) => l.column.origin.kind !== "test-run");
}

/** The list: waiting-on-you first, then the furthest along, then the most recent movement. */
export function listLanes(lanes: readonly LaneRow[], f: LaneFilters): LaneRow[] {
  const stopAt = f.stop ? KIT_STEPS.indexOf(f.stop) : -1;
  return railCohort(lanes, f)
    .filter((l) => {
      if (f.activeOnly && !l.column.active) return false;
      if (!columnMatchesFind(l.column, f.find.trim())) return false;
      if (stopAt >= 0 && !(l.furthest === stopAt && underWay(l.status))) return false;
      return true;
    })
    .sort((a, b) => {
      const needs = Number(b.status === "needs") - Number(a.status === "needs");
      if (needs) return needs;
      if (b.furthest !== a.furthest) return b.furthest - a.furthest;
      return (b.last ? Date.parse(b.last.occurredAt) : 0) - (a.last ? Date.parse(a.last.occurredAt) : 0);
    });
}
