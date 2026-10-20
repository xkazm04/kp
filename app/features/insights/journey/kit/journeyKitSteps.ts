/*
 * The kit lane board's steps (kit-unification Gate 3): which step an event proves, and what one
 * candidate's lane shows at each step.
 *
 * WHY STEPS AND NOT THE ROLE'S KIND RAIL AS THE HEAD. `RoleCluster.rail` is one rung per event
 * kind (3 to 14 per role in the live corpus, 2026-09-25). As a table head that is 46px a rung at
 * 1280 with the pane shut, and "42 of 45" alone needs ~56px, so the head could print neither a
 * label nor a count. The head groups the kinds into the cohort layer's own stages
 * (cohort/hiringAdapter.ts `hiringStageOf`, so both levels of the overlay file every kind under
 * the same stage), plus the two steps that grammar leaves out: the CV analysis (the step most
 * name-only rows sit on) and the work-sample case (whose absence, with its reason, is a step).
 * The role's full kind rail is not lost: the reading pane lists it per candidate.
 *
 * Pure and JSX-free, so node:test reaches it.
 */
import type { JourneyColumn, JourneyEvent, JourneyPhaseId } from "@/app/_lib/journey/types";
import type { ShapeKind, StageTone } from "../../../../_components/kit/types.ts";
import { hiringStageOf } from "../cohort/hiringAdapter.ts";
import { actorKind, isObservedRow } from "../journeyMarks.ts";
import { normalizeAbsenceKey } from "../journeyLayout.ts";

export const KIT_STEPS = ["analysed", "source", "case", "screen", "interview", "offer", "onboard"] as const;
export type KitStep = (typeof KIT_STEPS)[number];

/** The stage ramp a step's tiles are drawn in (graphic.css --tone-*); coral stays "needs you". */
export const STEP_TONE: Record<KitStep, StageTone> = {
  analysed: "quiet",
  source: "accepted",
  case: "default",
  screen: "screened",
  interview: "interview",
  offer: "offer",
  onboard: "hired",
};

/** The phase a step's absence is read from (`JourneyColumn.phases`). */
export const STEP_PHASE: Record<KitStep, JourneyPhaseId> = {
  analysed: "screening",
  source: "screening",
  case: "case",
  screen: "screening",
  interview: "screening",
  offer: "screening",
  onboard: "screening",
};

/**
 * The step an event KIND proves, or null for a kind that is no step (a rejection letter, a
 * decision marker, a kind nothing maps yet). Kind-only on purpose: the cohort payload the Roles
 * section reads carries kinds and no facts, and a head that filed "advanced to Hired" by its
 * destination would disagree with the Roles row drawn above it. A null step is never a dropped
 * row: every event still stands in the pane's trail.
 */
export function stepOfKind(kind: string): KitStep | null {
  if (kind === "analysis") return "analysed";
  if (kind.startsWith("case_")) return "case";
  return hiringStageOf(kind) ?? null;
}

/** A job-definition event belongs to the role's shared band, never to a candidate's lane. */
export function stepOfEvent(event: Pick<JourneyEvent, "kind" | "phase">): KitStep | null {
  return event.phase === "job-definition" ? null : stepOfKind(event.kind);
}

/**
 * Why a lane cell reads as it does:
 *  reached     events prove the step (the shape says how well)
 *  skipped     nothing here, but the journey went on (a dash ON the lane's path)
 *  notReached  nothing here and nothing later: the journey ends before it (a dash off the path)
 *  absent      the phase did not happen; `absenceKey` is its catalog reason, or null when the
 *              record gives none ("never recorded, no reason on file")
 *  hidden      rows exist here, but "Observed rows only" hid every one of them
 */
export type CellReason = "reached" | "skipped" | "notReached" | "absent" | "hidden";

export type KitCell = {
  step: KitStep;
  shape: ShapeKind;
  reason: CellReason;
  /** Events drawn at this step (after the observed-only filter). */
  events: JourneyEvent[];
  absenceKey?: string | null;
  /** Some event here was taken by an "auto:*" actor. */
  machine: boolean;
};

export type LaneOptions = { observedOnly: boolean; hasKey: (key: string) => boolean };

/**
 * The shape of a reached step: solid when one event there is a real, certainly attributed product
 * row; otherwise ring (generated: the column came from a test run) or half (matched by name alone).
 */
export function reachedShape(events: readonly JourneyEvent[], column: Pick<JourneyColumn, "origin">): ShapeKind {
  if (events.some((e) => isObservedRow(e, column.origin))) return "solid";
  if (column.origin.kind === "test-run") return "ring";
  return events.some((e) => e.confidence === "label-only") ? "half" : "ring";
}

/** One cell per KIT_STEPS entry, in order. */
export function laneCells(column: Pick<JourneyColumn, "events" | "origin" | "phases">, opts: LaneOptions): KitCell[] {
  const all = new Map<KitStep, JourneyEvent[]>();
  for (const event of column.events) {
    const step = stepOfEvent(event);
    if (!step) continue;
    const bucket = all.get(step);
    if (bucket) bucket.push(event);
    else all.set(step, [event]);
  }
  const rows = KIT_STEPS.map((step) => {
    const found = all.get(step) ?? [];
    const shown = opts.observedOnly ? found.filter((e) => isObservedRow(e, column.origin)) : found;
    return { step, found, shown };
  });
  let last = -1;
  rows.forEach((r, i) => {
    if (r.shown.length) last = i;
  });
  return rows.map((r, i): KitCell => {
    const base = { step: r.step, events: r.shown, machine: r.shown.some((e) => actorKind(e.actor) === "machine") };
    if (r.shown.length) return { ...base, shape: reachedShape(r.shown, column), reason: "reached" };
    if (r.found.length) return { ...base, shape: "dashed", reason: "hidden" };
    const phase = column.phases[STEP_PHASE[r.step]];
    if (phase && !phase.present) {
      const key = normalizeAbsenceKey(phase.absenceReasonKey);
      return { ...base, shape: "dashed", reason: "absent", absenceKey: opts.hasKey(key) ? key : null };
    }
    return { ...base, shape: "none", reason: i < last ? "skipped" : "notReached" };
  });
}

/** The furthest step with a drawn event, or -1 when the lane reached nothing. */
export function furthestStep(cells: readonly KitCell[]): number {
  let last = -1;
  cells.forEach((c, i) => {
    if (c.reason === "reached") last = i;
  });
  return last;
}

/** How many instances of a cohort reached each step: the Roles section's mini rail. */
export function cohortReach(instances: readonly { steps: readonly { kind: string }[] }[]): number[] {
  const reached = KIT_STEPS.map(() => 0);
  for (const inst of instances) {
    const seen = new Set<KitStep>();
    for (const s of inst.steps) {
      const step = stepOfKind(s.kind);
      if (step) seen.add(step);
    }
    KIT_STEPS.forEach((step, i) => {
      if (seen.has(step)) reached[i] += 1;
    });
  }
  return reached;
}
