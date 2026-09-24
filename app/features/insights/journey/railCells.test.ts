// `skipped` vs `never-reached` — the pair the owner asked to import from the
// contest's runner-up, and the one distinction that turns a cohort's ragged
// floor into a funnel. Getting it backwards would tell a recruiter a process
// step is being bypassed when in fact nobody is getting that far.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { JourneyRailStep } from "@/app/_lib/journey/types";
import { alignEventsToRail, eventStepKey, lastReachedRailIndex, railCellState, railStepKey } from "./railCells.ts";

const rail: JourneyRailStep[] = [
  { index: 0, phase: "screening", kind: "analysis", reached: 3, cohort: 4, byMachine: 3 },
  { index: 1, phase: "screening", kind: "acknowledgement_sent", reached: 3, cohort: 4, byMachine: 3 },
  { index: 2, phase: "screening", kind: "screening_hold", reached: 2, cohort: 4, byMachine: 0 },
  { index: 3, phase: "screening", kind: "advanced", reached: 1, cohort: 4, byMachine: 0 },
];

const row = (kind: string, topicCode?: "salary-band") => ({ kind, topicCode });

test("a step's identity is its kind plus its topic, never its index", () => {
  assert.equal(railStepKey({ kind: "intake_round", topicCode: "salary-band" }), eventStepKey(row("intake_round", "salary-band")));
  assert.notEqual(railStepKey({ kind: "intake_round" }), railStepKey({ kind: "intake_round", topicCode: "salary-band" }));
  // Two rungs of the same kind at different positions share a key on purpose:
  // the key is what an event is matched ON, not where it sits.
  assert.equal(railStepKey(rail[0]), railStepKey({ kind: rail[0].kind, topicCode: rail[0].topicCode }));
});

test("events align onto the rail as a subsequence, in order", () => {
  const { placedAt, occupied, overflow } = alignEventsToRail(
    [row("analysis"), row("screening_hold")],
    rail
  );
  assert.deepEqual(placedAt, [0, 2]);
  assert.deepEqual([...occupied].sort(), [0, 2]);
  assert.deepEqual(overflow, []);
});

test("an event with no remaining rung overflows rather than disappearing", () => {
  const { placedAt, overflow } = alignEventsToRail([row("analysis"), row("analysis")], rail);
  assert.deepEqual(placedAt, [0, -1]);
  assert.deepEqual(overflow, [1], "the second analysis is kept, off-rail");
});

test("an out-of-rail kind overflows instead of colliding with an unrelated rung", () => {
  const { placedAt, overflow } = alignEventsToRail([row("offer_sent")], rail);
  assert.deepEqual(placedAt, [-1]);
  assert.deepEqual(overflow, [0]);
});

test("skipped means the journey went on; never-reached means it ended", () => {
  const wentOn = { events: [row("analysis"), row("advanced")] };
  assert.equal(railCellState(wentOn, rail[0], rail), "present");
  assert.equal(railCellState(wentOn, rail[1], rail), "skipped", "no acknowledgement, but an advance later");
  assert.equal(railCellState(wentOn, rail[2], rail), "skipped");
  assert.equal(railCellState(wentOn, rail[3], rail), "present");

  const ended = { events: [row("analysis"), row("acknowledgement_sent")] };
  assert.equal(railCellState(ended, rail[1], rail), "present");
  assert.equal(railCellState(ended, rail[2], rail), "never-reached");
  assert.equal(railCellState(ended, rail[3], rail), "never-reached");

  // A column with nothing at all never reached anything — it does not "skip"
  // the whole rail, which would imply a journey that went somewhere.
  const nothing = { events: [] };
  for (const step of rail) assert.equal(railCellState(nothing, step, rail), "never-reached");
});

test("lastReachedRailIndex is -1 for a column that reached no step", () => {
  assert.equal(lastReachedRailIndex(new Set()), -1);
  assert.equal(lastReachedRailIndex(new Set([0, 3, 2])), 3);
});
