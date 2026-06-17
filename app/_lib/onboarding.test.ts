import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceTasks, onboardingProgress, type OnboardingTask } from "./onboarding.ts";

test("coerceTasks trims, drops blanks, de-dups ids, caps length", () => {
  const tasks = coerceTasks([
    { id: "a", label: "  First step  " },
    { label: "Auto slug from label!" },
    { id: "a", label: "Dup id step" }, // collides with first → re-keyed
    { label: "" }, // dropped (blank)
    { label: "   " }, // dropped (whitespace)
    "not an object", // dropped
  ]);
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0].id, "a");
  assert.equal(tasks[0].label, "First step");
  assert.equal(tasks[1].id, "auto-slug-from-label"); // slugified
  assert.notEqual(tasks[2].id, "a"); // re-keyed off the collision
  // ids are unique
  assert.equal(new Set(tasks.map((t) => t.id)).size, 3);
});

test("coerceTasks tolerates non-array input", () => {
  assert.deepEqual(coerceTasks(null), []);
  assert.deepEqual(coerceTasks("nope"), []);
  assert.deepEqual(coerceTasks({}), []);
});

test("onboardingProgress counts done over template tasks (sparse states)", () => {
  const tasks: OnboardingTask[] = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
    { id: "d", label: "D" },
  ];
  const p = onboardingProgress(tasks, [
    { taskId: "a", done: true, doneAt: "x" },
    { taskId: "b", done: false, doneAt: null },
    { taskId: "c", done: true, doneAt: "x" },
    // d has no state → not done
    { taskId: "ghost", done: true, doneAt: "x" }, // a state for a removed task → ignored
  ]);
  assert.equal(p.total, 4);
  assert.equal(p.done, 2); // a + c
  assert.equal(p.pct, 50);
  assert.equal(p.complete, false);
});

test("onboardingProgress is complete only when every task is done", () => {
  const tasks: OnboardingTask[] = [{ id: "a", label: "A" }];
  assert.equal(onboardingProgress(tasks, [{ taskId: "a", done: true, doneAt: "x" }]).complete, true);
  // empty template never reads as complete, and never divides by zero
  assert.deepEqual(onboardingProgress([], []), { done: 0, total: 0, pct: 0, complete: false });
});
