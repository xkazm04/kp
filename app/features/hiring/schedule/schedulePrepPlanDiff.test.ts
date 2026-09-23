// Pins the regenerate PREVIEW (r09 schedule-interview-prep/B): what a staged plan would
// change, computed BEFORE the swap from the same rules the post-swap render uses
// (splitImported for woven questions, the `c-<i>` / `k-<i>` / `w-<i>` tick keys of
// prepProgress). A merge that reports nothing is indistinguishable from one that
// destroyed everything, so every consequence the interviewer would otherwise only
// discover afterwards is a field here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePlanDiff } from "./schedulePrepPlanDiff.ts";
import type { Prep } from "./scheduleInterviewPrepTypes.ts";

const block = (topic: string, fromMin: number, toMin: number) => ({ topic, goal: `Goal of ${topic}`, questions: [`Ask about ${topic}?`], fromMin, toMin });

function plan(chronology: ReturnType<typeof block>[], extra: Partial<Prep> = {}): Prep {
  return {
    scenario: "A structured interview.",
    durationMin: 25,
    focusAreas: [],
    chronology,
    signals: ["Probed depth"],
    source: "llm",
    ...extra,
  } as Prep;
}

const current = plan([block("Intro", 0, 5), block("System design", 5, 20), block("Wrap", 20, 25)]);

test("added and removed blocks by topic; a shared topic with a new range is retimed with both ranges", () => {
  const candidate = plan([block("Intro", 0, 5), block("Testing", 5, 20), block("Wrap", 20, 25)]);
  const d = computePlanDiff(current, candidate, {}, []);
  assert.deepEqual(d.added, ["Testing"]);
  assert.deepEqual(d.removed, ["System design"]);
  assert.deepEqual(d.retimed, []);

  const retimed = plan([block("Intro", 0, 8), block("System design", 8, 22), block("Wrap", 22, 25)]);
  const r = computePlanDiff(current, retimed, {}, []);
  assert.deepEqual(r.added, []);
  assert.deepEqual(r.removed, []);
  assert.deepEqual(r.retimed, [
    { topic: "Intro", from: { fromMin: 0, toMin: 5 }, to: { fromMin: 0, toMin: 8 } },
    { topic: "System design", from: { fromMin: 5, toMin: 20 }, to: { fromMin: 8, toMin: 22 } },
    { topic: "Wrap", from: { fromMin: 20, toMin: 25 }, to: { fromMin: 22, toMin: 25 } },
  ]);
  assert.equal(r.isNoop, false);
});

test("a woven question whose block topic the candidate drops is reported as returning to unassigned", () => {
  const candidate = plan([block("Intro", 0, 5), block("Testing", 5, 20), block("Wrap", 20, 25)]);
  const imported = [
    { question: "Q1", blockRef: "System design" },
    { question: "Q2", blockRef: "Intro" }, // its block survives
    { question: "Q3" }, // already unassigned: nothing changes for it
  ];
  const d = computePlanDiff(current, candidate, {}, imported);
  assert.deepEqual(d.wovenOrphaned, ["Q1"]);
});

test("ticks with no item in the candidate detach; identical plans are a no-op with every list empty", () => {
  const four = plan([block("Intro", 0, 5), block("System design", 5, 15), block("Testing", 15, 20), block("Wrap", 20, 25)]);
  const three = plan([block("Intro", 0, 5), block("System design", 5, 15), block("Testing", 15, 20)]);
  const d = computePlanDiff(four, three, { "c-3": true, "k-0": true }, []);
  assert.equal(d.checkedDetached, 1, "c-3 has no block in a 3-block plan; k-0 still has its signal");
  assert.equal(d.checkedMoved, 0);

  const same = computePlanDiff(current, structuredClone(current), { "c-0": true, "k-0": true }, [{ question: "Q1", blockRef: "Intro" }]);
  assert.equal(same.isNoop, true);
  assert.deepEqual(same.added, []);
  assert.deepEqual(same.removed, []);
  assert.deepEqual(same.retimed, []);
  assert.deepEqual(same.reworded, []);
  assert.deepEqual(same.signalsAdded, []);
  assert.deepEqual(same.signalsRemoved, []);
  assert.deepEqual(same.wovenOrphaned, []);
  assert.equal(same.checkedDetached, 0);
  assert.equal(same.checkedMoved, 0);
});

test("a tick whose index now holds a DIFFERENT block is reported as moved, not silently re-attached", () => {
  const candidate = plan([block("Intro", 0, 5), block("Testing", 5, 20), block("Wrap", 20, 25)]);
  const d = computePlanDiff(current, candidate, { "c-1": true, "c-0": true }, []);
  assert.equal(d.checkedMoved, 1, "c-1 was System design and would now tick Testing");
  assert.equal(d.checkedDetached, 0);
});

test("a template fallback replacing an AI plan is disclosed through source and duration", () => {
  const candidate = plan(current.chronology, { source: "deterministic", durationMin: 30 });
  const d = computePlanDiff(current, candidate, {}, []);
  assert.equal(d.sourceFrom, "llm");
  assert.equal(d.sourceTo, "deterministic");
  assert.equal(d.durationFrom, 25);
  assert.equal(d.durationTo, 30);
  assert.equal(d.isNoop, false);
});
