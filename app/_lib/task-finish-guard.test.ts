// finishTask's terminal guard. `markTaskRunning` and `setTaskProgress` have both
// carried a `status IN ('queued','running')` precondition since they were written;
// finishTask — the ONE transition that writes a terminal state and a result — did
// not. Two live paths reach it late:
//
//   • Cancel. `cancelTask` aborts the controller and stamps `canceled` itself, but
//     the abort is cooperative: a Python child takes seconds to die and an LLM call
//     longer, so runOne's own finish lands AFTER, and used to overwrite the row with
//     `succeeded` plus the result of work the operator had already cancelled.
//   • The wall-clock reaper. It stamps `interrupted` on a run it has given up on;
//     if that run then returns, the reaper's verdict was silently un-done.
//
// Isolated throwaway DB — unit-db.ts must be the first project import (it sets
// KP_DB_PATH before any store opens a connection).
//
// Runner: node:test, via `npm run test:unit`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createTask, finishTask, getTask, markTaskRunning } from "./db/tasks.ts";

after(() => cleanupUnitDb());

let seq = 0;
function newTask() {
  seq += 1;
  return createTask(`finish-${seq}`, "analyze", `dedupe-finish-${seq}`, `Analyze · fixture ${seq}`, { n: seq });
}

test("a queued or running task is finished normally", () => {
  const queued = newTask();
  assert.equal(finishTask(queued.id, "canceled", {}), true, "cancelling before pick-up must still write");
  assert.equal(getTask(queued.id)?.status, "canceled");

  const running = newTask();
  markTaskRunning(running.id);
  assert.equal(finishTask(running.id, "succeeded", { result: { ok: true } }), true);
  const done = getTask(running.id);
  assert.equal(done?.status, "succeeded");
  assert.deepEqual(done?.result, { ok: true });
});

test("a terminal row is never restamped by a late handler", () => {
  const t = newTask();
  markTaskRunning(t.id);
  // The operator cancels; the handler is still winding down.
  assert.equal(finishTask(t.id, "canceled", {}), true);
  // …and then finishes, claiming success and carrying a result.
  assert.equal(finishTask(t.id, "succeeded", { result: { advanced: 9 } }), false, "the late write must be dropped");
  const row = getTask(t.id);
  assert.equal(row?.status, "canceled", "terminal is final");
  assert.equal(row?.result, null, "a cancelled run must not acquire a result");
  assert.equal(row?.error, null);
});

test("the reaper's verdict survives the run it gave up on", () => {
  const t = newTask();
  markTaskRunning(t.id);
  assert.equal(finishTask(t.id, "interrupted", { error: "reaped: past the wall-clock budget" }), true);
  assert.equal(finishTask(t.id, "failed", { error: "provider timeout" }), false);
  const row = getTask(t.id);
  assert.equal(row?.status, "interrupted");
  assert.match(String(row?.error), /reaped/, "the later error must not overwrite the reaper's reason");
});

test("finishing a task that does not exist is a dropped write, not a throw", () => {
  assert.equal(finishTask("no-such-task", "succeeded", { result: 1 }), false);
});
