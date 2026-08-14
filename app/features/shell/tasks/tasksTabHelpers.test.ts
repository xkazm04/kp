// The consolidated run table replaced two headed lists (In progress / Done) with
// one sorted table, which means ORDER is now the only thing telling a reader
// "this is happening now" from "this already happened". That makes sortTasks a
// contract, not a detail — pinned here.
import test from "node:test";
import assert from "node:assert/strict";
import { ALL_STATUSES, sortTasks, taskTime } from "./tasksTabHelpers";
import type { Task, TaskStatus } from "./tasksProviderTypes";

function task(id: string, status: TaskStatus, stamps: Partial<Pick<Task, "createdAt" | "startedAt" | "finishedAt">> = {}): Task {
  return {
    id,
    kind: "analyze",
    label: null,
    status,
    params: null,
    result: null,
    error: null,
    progressDone: 0,
    progressTotal: 0,
    progressMsg: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    seenAt: null,
    ...stamps,
  };
}

test("active runs sort above terminal ones, running above queued", () => {
  const ordered = sortTasks([
    task("done", "succeeded", { finishedAt: "2026-08-14T10:00:00.000Z" }),
    task("queued", "queued"),
    task("running", "running", { startedAt: "2026-08-14T09:00:00.000Z" }),
  ]);
  assert.deepEqual(ordered.map((t) => t.id), ["running", "queued", "done"]);
});

test("within the terminal band the newest run leads, whatever its outcome", () => {
  const ordered = sortTasks([
    task("old", "failed", { finishedAt: "2026-08-10T00:00:00.000Z" }),
    task("new", "canceled", { finishedAt: "2026-08-14T00:00:00.000Z" }),
    task("mid", "succeeded", { finishedAt: "2026-08-12T00:00:00.000Z" }),
  ]);
  assert.deepEqual(ordered.map((t) => t.id), ["new", "mid", "old"]);
});

test("sortTasks does not mutate its input", () => {
  const input = [task("a", "succeeded", { finishedAt: "2026-08-10T00:00:00.000Z" }), task("b", "running")];
  const before = input.map((t) => t.id);
  sortTasks(input);
  assert.deepEqual(input.map((t) => t.id), before);
});

test("taskTime falls back finished -> started -> created, and never returns NaN", () => {
  assert.equal(taskTime(task("a", "queued")), Date.parse("2026-08-01T00:00:00.000Z"));
  assert.equal(
    taskTime(task("b", "running", { startedAt: "2026-08-05T00:00:00.000Z" })),
    Date.parse("2026-08-05T00:00:00.000Z")
  );
  assert.equal(
    taskTime(task("c", "succeeded", { startedAt: "2026-08-05T00:00:00.000Z", finishedAt: "2026-08-06T00:00:00.000Z" })),
    Date.parse("2026-08-06T00:00:00.000Z")
  );
  assert.equal(taskTime(task("d", "succeeded", { createdAt: "not-a-date" })), 0);
});

test("the Status filter offers every status, active states first", () => {
  assert.deepEqual(ALL_STATUSES, ["running", "queued", "succeeded", "failed", "canceled", "interrupted"]);
});
