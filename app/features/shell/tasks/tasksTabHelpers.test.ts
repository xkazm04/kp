// The consolidated run table replaced two headed lists (In progress / Done) with
// one sorted table, which means ORDER is now the only thing telling a reader
// "this is happening now" from "this already happened". That makes sortTasks a
// contract, not a detail — pinned here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_STATUSES, REPLAY_REASON_KEY, rowRetryAction, sortTasks, taskTime, unseenIdsOf } from "./tasksTabHelpers";
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

// ---- the read/unread ack set ----------------------------------------------
// The dwell-ack stamps seen_at, which clears the sidebar's unread AND failed
// badges. It therefore may only cover rows the recruiter could actually SEE:
// acking the whole polled window (up to 60 rows) while the table paginates 20 at
// a time silently swallowed the outcomes on every page the reader never turned to.

test("only terminal, still-unread rows are ackable", () => {
  const seen = task("acked", "succeeded");
  seen.seenAt = "2026-08-14T10:00:00.000Z";
  const ids = unseenIdsOf([
    task("running", "running"),
    task("queued", "queued"),
    task("fresh-fail", "failed"),
    seen,
    task("fresh-ok", "succeeded"),
  ]);
  // Active rows are never "seen" (their outcome hasn't happened yet) and an
  // already-acked row is never re-stamped.
  assert.deepEqual(ids, ["fresh-fail", "fresh-ok"]);
});

test("the ack covers the rows handed in, not a wider window", () => {
  const window20 = Array.from({ length: 20 }, (_, i) => task(`p1-${i}`, "succeeded"));
  const offPage = [task("p2-fail", "failed"), task("p2-ok", "succeeded")];
  // The page slice is what gets acked; the rows the pager did not draw stay unread.
  const acked = unseenIdsOf(window20);
  assert.equal(acked.length, 20);
  for (const t of offPage) assert.ok(!acked.includes(t.id), `${t.id} was never on screen`);
  assert.deepEqual(unseenIdsOf([...window20, ...offPage]).length, 22, "the whole window would ack 22");
});

test("the dwell-ack is wired to the PAGED rows, not to the polled window", () => {
  // Source-level (a .tsx cannot be loaded by the node runner): the ack has to live
  // where the page slice does. It used to run in TasksTab over the full `tasks`
  // array, which is exactly the bug this pins shut.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (file: string) => readFileSync(path.join(here, file), "utf8");
  const panel = read("TasksRunsPanel.tsx");
  assert.match(panel, /unseenIdsOf\(shown\)/, "the panel must derive the ack set from its page slice");
  assert.match(panel, /onSeen\(ids\)/, "…and hand exactly those ids to the ack");
  assert.doesNotMatch(read("TasksTab.tsx"), /markSeen\(/, "the tab must not ack the unpaginated window");
});

// ── challenge-r05 workspace-config-api/B: the row reads the server's replay verdict ──

test("rowRetryAction: a dead analyze whose inputs are gone names the reason and the Analyze door", () => {
  const row = { ...task("a", "failed"), kind: "analyze", replay: { replayable: false as const, reason: "inputs-gone" as const } };
  assert.deepEqual(rowRetryAction(row), { kind: "blocked", reason: "inputs-gone", door: { tab: "analyze" } });
});

test("rowRetryAction: a replayable dead row offers Retry", () => {
  assert.deepEqual(rowRetryAction({ ...task("b", "failed"), replay: { replayable: true as const } }), { kind: "retry" });
});

test("rowRetryAction: an older server that sends no verdict degrades to today's Retry", () => {
  for (const status of ["failed", "interrupted", "canceled"] as const) {
    assert.deepEqual(rowRetryAction(task("c", status)), { kind: "retry" }, status);
  }
});

test("rowRetryAction: a succeeded or active row offers nothing", () => {
  for (const status of ["succeeded", "running", "queued"] as const) {
    assert.deepEqual(rowRetryAction(task("d", status)), { kind: "none" }, status);
    assert.deepEqual(rowRetryAction({ ...task("d", status), replay: null }), { kind: "none" }, status);
  }
});

test("rowRetryAction: seat and retired-kind blocks carry no door (no tab can run them for this caller)", () => {
  assert.deepEqual(rowRetryAction({ ...task("e", "failed"), kind: "batch_screen", replay: { replayable: false as const, reason: "no-seat" as const } }), {
    kind: "blocked",
    reason: "no-seat",
    door: null,
  });
  assert.deepEqual(rowRetryAction({ ...task("f", "failed"), kind: "old", replay: { replayable: false as const, reason: "kind-retired" as const } }), {
    kind: "blocked",
    reason: "kind-retired",
    door: null,
  });
});

test("every blocked reason resolves to a catalog key, never server English", () => {
  const en = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../messages/en.json"), "utf8"));
  for (const reason of ["inputs-gone", "kind-retired", "no-seat"] as const) {
    const key = REPLAY_REASON_KEY[reason];
    assert.equal(typeof en.tasks.replay[key], "string", `tasks.replay.${key}`);
  }
  assert.equal(typeof en.tasks.replay.openAnalyze, "string");
});
