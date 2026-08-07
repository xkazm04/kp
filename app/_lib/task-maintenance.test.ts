import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isTaskStale,
  tasksToReap,
  tasksToPrune,
  taskRetentionCutoffIso,
  TASK_MAX_RUNTIME_MS,
  TASK_RETENTION_DAYS,
} from "./task-maintenance.ts";

// bug-ui-scan-2026-07-09 #2 (wall-clock reaper) + #3 (retention prune). Pure
// decisions pinned here so the runner/store just wire them to the DB.

const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const DAY = 24 * 60 * 60 * 1000;

// ── #2 isTaskStale ─────────────────────────────────────────────────────────

test("a task running inside its budget is not stale; past it, it is", () => {
  assert.equal(isTaskStale(NOW, iso(-(TASK_MAX_RUNTIME_MS - 1000)), TASK_MAX_RUNTIME_MS), false);
  assert.equal(isTaskStale(NOW, iso(-(TASK_MAX_RUNTIME_MS + 1000)), TASK_MAX_RUNTIME_MS), true);
});

test("the budget boundary is exclusive (exactly at the budget is not yet stale)", () => {
  assert.equal(isTaskStale(NOW, iso(-TASK_MAX_RUNTIME_MS), TASK_MAX_RUNTIME_MS), false);
  assert.equal(isTaskStale(NOW, iso(-(TASK_MAX_RUNTIME_MS + 1)), TASK_MAX_RUNTIME_MS), true);
});

test("a null / absent / unparseable start stamp is never reaped on a guess", () => {
  assert.equal(isTaskStale(NOW, null), false);
  assert.equal(isTaskStale(NOW, undefined), false);
  assert.equal(isTaskStale(NOW, "not-a-date"), false);
});

test("tasksToReap returns exactly the running rows past the budget", () => {
  const rows = [
    { id: "fresh", startedAt: iso(-1000) },
    { id: "wedged", startedAt: iso(-(TASK_MAX_RUNTIME_MS + 60_000)) },
    { id: "nostamp", startedAt: null },
    { id: "alsoWedged", startedAt: iso(-(TASK_MAX_RUNTIME_MS + 5 * 60_000)) },
  ];
  assert.deepEqual(tasksToReap(rows, NOW), ["wedged", "alsoWedged"]);
});

// ── #3 tasksToPrune / retention ────────────────────────────────────────────

test("tasksToPrune deletes terminal rows past retention but NEVER an in-flight one", () => {
  const old = iso(-(TASK_RETENTION_DAYS + 5) * DAY);
  const rows = [
    { id: "oldDone", status: "succeeded", finishedAt: old, createdAt: old },
    { id: "oldFailed", status: "failed", finishedAt: old, createdAt: old },
    // in-flight rows are untouchable no matter how ancient their created_at is:
    { id: "ancientRunning", status: "running", finishedAt: null, createdAt: old },
    { id: "ancientQueued", status: "queued", finishedAt: null, createdAt: old },
    // still inside retention → kept:
    { id: "recentDone", status: "succeeded", finishedAt: iso(-2 * DAY), createdAt: iso(-2 * DAY) },
  ];
  assert.deepEqual(tasksToPrune(rows, NOW).sort(), ["oldDone", "oldFailed"]);
});

test("tasksToPrune falls back to created_at when finished_at is missing, and skips garbled stamps", () => {
  const old = iso(-(TASK_RETENTION_DAYS + 1) * DAY);
  const rows = [
    { id: "noFinish", status: "canceled", finishedAt: null, createdAt: old },
    { id: "garbled", status: "succeeded", finishedAt: "junk", createdAt: "junk" },
  ];
  assert.deepEqual(tasksToPrune(rows, NOW), ["noFinish"]);
});

test("the retention cutoff is exactly now minus the retention window", () => {
  assert.equal(taskRetentionCutoffIso(NOW), new Date(NOW - TASK_RETENTION_DAYS * DAY).toISOString());
});
