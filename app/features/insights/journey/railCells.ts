// How one column meets one rail step — the concept the owner asked to import
// from the contest's runner-up ("The Ladder").
//
// ─────────────────────────────────────────────────────────────────────────────
// SEAM NOTICE — read before changing this file.
//
// P3's brief says to call `railCellState(column, step)` from
// `app/_lib/journey/project.ts`. THAT MODULE DOES NOT EXIST IN THIS TREE YET
// (2026-09-21: `app/_lib/journey/` holds only `types.ts` and `render-keys.ts`),
// and P3's file scope forbids creating it. Importing a module that is not there
// would make the whole board un-buildable and un-reviewable on its own, so the
// board calls THIS module instead, which implements the documented semantics
// verbatim.
//
// When the projector lands, the swap is one line: replace the body of
// `railCellState` below with
//
//     export { railCellState } from "@/app/_lib/journey/project";
//
// and delete the helpers it no longer needs. Nothing else in the board imports
// the state machine directly — `journeyLayout.ts` is the only consumer.
//
// One real difference to reconcile at that point: the brief states a 2-argument
// signature `(column, step)`, but "skipped" and "never-reached" are only
// distinguishable if you know what comes AFTER the step, which a single step
// cannot say. This version takes the cluster's `rail` as a third argument. If
// the projector's version closes over the rail some other way, the call site in
// `journeyLayout.ts` is the single place to adjust.
// ─────────────────────────────────────────────────────────────────────────────

import type { JourneyEvent, JourneyRailCellState, JourneyRailStep } from "@/app/_lib/journey/types";

/**
 * The identity of a step, and of the event that satisfies it.
 *
 * A rail step is a `kind` plus, for a conversational round, a `topicCode` — the
 * same pair `journeyEventMessageKey` renders through. Two steps with the same
 * kind at different indexes are two distinct rungs (a repeated kind becomes a
 * numbered rung), so the key deliberately does NOT include the index: it is what
 * an event is matched ON, not where it sits.
 */
export function railStepKey(step: Pick<JourneyRailStep, "kind" | "topicCode">): string {
  return `${step.kind}\u0000${step.topicCode ?? ""}`;
}

export function eventStepKey(event: Pick<JourneyEvent, "kind" | "topicCode">): string {
  return `${event.kind}\u0000${event.topicCode ?? ""}`;
}

/**
 * Align one column's events onto the rail, in order.
 *
 * A column's events are a SUBSEQUENCE of the rail: the rail is derived from the
 * kinds that occurred anywhere in the role, so a given column has some of them,
 * in the same order. The two-pointer walk below places each event on the first
 * rail step at or after the last one used that matches it; an event with no
 * remaining match is returned as `overflow` rather than dropped, because a row
 * the board silently swallows is the failure this whole feature exists to stop.
 *
 * Returns `placedAt[i] = railIndex | -1` parallel to `events`, plus the set of
 * rail indexes that got an event.
 */
export function alignEventsToRail(
  events: readonly Pick<JourneyEvent, "kind" | "topicCode">[],
  rail: readonly JourneyRailStep[]
): { placedAt: number[]; occupied: Set<number>; overflow: number[] } {
  const keys = rail.map(railStepKey);
  const placedAt: number[] = [];
  const occupied = new Set<number>();
  const overflow: number[] = [];
  let next = 0;
  for (let i = 0; i < events.length; i++) {
    const key = eventStepKey(events[i]);
    let j = next;
    while (j < keys.length && keys[j] !== key) j++;
    if (j < keys.length) {
      placedAt.push(j);
      occupied.add(j);
      next = j + 1;
    } else {
      placedAt.push(-1);
      overflow.push(i);
    }
  }
  return { placedAt, occupied, overflow };
}

/**
 * `"present" | "skipped" | "never-reached"` — three different facts that must
 * never render alike (types.ts, JourneyRailCellState):
 *
 *  - `present`       the column has an event at this step.
 *  - `skipped`       it has none here but DOES have one further along the rail:
 *                    the journey went on without this step.
 *  - `never-reached` it has none here and none later either: the journey ended
 *                    before this point. That is a funnel floor, not a gap.
 */
export function railCellState(
  column: { events: readonly Pick<JourneyEvent, "kind" | "topicCode">[] },
  step: JourneyRailStep,
  rail: readonly JourneyRailStep[]
): JourneyRailCellState {
  const { occupied } = alignEventsToRail(column.events, rail);
  if (occupied.has(step.index)) return "present";
  for (const index of occupied) if (index > step.index) return "skipped";
  return "never-reached";
}

/**
 * The rail index after which a column has nothing at all — the row its
 * "never reached" block starts from. `-1` when the column reached no step.
 *
 * Hoisted out of `railCellState` because a board asks this question once per
 * column and then answers every cell from it; calling `railCellState` per cell
 * would re-walk the column's events once per rung, which is the shape that makes
 * a 99-column board quadratic.
 */
export function lastReachedRailIndex(occupied: ReadonlySet<number>): number {
  let last = -1;
  for (const index of occupied) if (index > last) last = index;
  return last;
}
