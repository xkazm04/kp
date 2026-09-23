// Acceptance cases for glyphArrival.ts (challenge-r03 glyph-system/B): an empty
// state that a running background task is about to fill says so instead of
// claiming "caught up", never claims it from a frozen queue snapshot, and asks its
// surface to reload the moment work lands — useLiveRefresh does NOT fire when a
// task finishes (it listens to kp:data-changed from UI mutators only), so without
// that edge the arriving state would hand over to "caught up" with the new
// decisions sitting unrendered.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARRIVAL_AMBIENT,
  ARRIVAL_KINDS,
  EMPTY_ARRIVAL_WATCH,
  ambientFor,
  resolveArrival,
  stepArrival,
  type ArrivalTask,
} from "./glyphArrival.ts";
import { GLYPH_BY_TAB } from "./glyphRegistry.ts";
import { isTaskKind } from "../../_lib/task-kinds.ts";
import { AMBIENT_PRESETS } from "./motionPresets.ts";
import { ACTIVE, type Task } from "../../features/shell/tasks/tasksProviderTypes.ts";

let seq = 0;
function task(kind: string, status: ArrivalTask["status"], done = 0, total = 0, id?: string): ArrivalTask {
  return { id: id ?? `t${++seq}`, kind, status, progressDone: done, progressTotal: total };
}

test("a running batch_screen makes empty Decisions an arrival with its progress", () => {
  const got = resolveArrival({
    tab: "decisions",
    tasks: [task("batch_screen", "running", 3, 10)],
    loadFailed: false,
  });
  assert.deepEqual(got, { mode: "arriving", count: 1, done: 3, total: 10 });
});

test("progress is summed only over tasks that report a total", () => {
  const got = resolveArrival({
    tab: "decisions",
    tasks: [task("automation", "queued"), task("automation", "queued"), task("batch_screen", "running", 4, 12)],
    loadFailed: false,
  });
  assert.deepEqual(got, { mode: "arriving", count: 3, done: 4, total: 12 });
});

test("a finished task is not an arrival", () => {
  const got = resolveArrival({
    tab: "decisions",
    tasks: [
      task("batch_screen", "succeeded", 10, 10),
      task("automation", "failed"),
      task("batch_screen", "canceled", 2, 9),
      task("automation", "interrupted"),
    ],
    loadFailed: false,
  });
  assert.deepEqual(got, { mode: "idle" });
});

test("a frozen queue snapshot never makes an in-flight claim", () => {
  const got = resolveArrival({
    tab: "decisions",
    tasks: [task("batch_screen", "running", 1, 5)],
    loadFailed: true,
  });
  assert.deepEqual(got, { mode: "idle" });
});

test("a tab with no declared arrival kinds never claims one", () => {
  const got = resolveArrival({ tab: "library", tasks: [task("jd_build", "running", 1, 3)], loadFailed: false });
  assert.deepEqual(got, { mode: "idle" });
  // …and an unrelated kind on a declared tab is not an arrival either.
  assert.deepEqual(
    resolveArrival({ tab: "decisions", tasks: [task("jd_build", "running")], loadFailed: false }),
    { mode: "idle" },
  );
});

test("ambient: arriving pulses, idle stays still; the vocabulary is closed on both sides", () => {
  assert.equal(ambientFor({ mode: "arriving", count: 1, done: 0, total: 0 }), "pulse");
  assert.equal(ambientFor({ mode: "idle" }), undefined);
  assert.ok(Object.hasOwn(AMBIENT_PRESETS, ARRIVAL_AMBIENT));
  for (const [tab, kinds] of Object.entries(ARRIVAL_KINDS)) {
    assert.ok(Object.hasOwn(GLYPH_BY_TAB, tab), `${tab} is not a GLYPH_BY_TAB key`);
    for (const k of kinds) assert.ok(isTaskKind(k), `${k} is not a TaskKind`);
  }
});

test("the in-flight predicate agrees with the provider's ACTIVE for every status", () => {
  const statuses = ["queued", "running", "succeeded", "failed", "canceled", "interrupted"] as const;
  for (const status of statuses) {
    const arriving = resolveArrival({ tab: "decisions", tasks: [task("batch_screen", status)], loadFailed: false });
    assert.equal(arriving.mode === "arriving", ACTIVE({ status } as Task), status);
  }
});

test("arriving -> idle for the same task id emits a reload exactly once", () => {
  const id = "screen-1";
  const running = { tab: "decisions" as const, tasks: [task("batch_screen", "running", 3, 10, id)], loadFailed: false };
  const done = { tab: "decisions" as const, tasks: [task("batch_screen", "succeeded", 10, 10, id)], loadFailed: false };

  const a = stepArrival(EMPTY_ARRIVAL_WATCH, running);
  assert.equal(a.reload, false, "starting to watch is not a landing");
  assert.equal(a.arrival.mode, "arriving");

  const b = stepArrival(a.watch, running);
  assert.equal(b.reload, false, "an unchanged poll does not reload");

  const c = stepArrival(b.watch, done);
  assert.equal(c.reload, true, "the task finished: its decisions are in the DB");
  assert.deepEqual(c.arrival, { mode: "idle" });

  const d = stepArrival(c.watch, done);
  assert.equal(d.reload, false, "the edge fires once, not on every later poll");
});

test("a task that drops out of the polled window also counts as landed", () => {
  const a = stepArrival(EMPTY_ARRIVAL_WATCH, {
    tab: "decisions",
    tasks: [task("automation", "running", 0, 0, "auto-1")],
    loadFailed: false,
  });
  const b = stepArrival(a.watch, { tab: "decisions", tasks: [], loadFailed: false });
  assert.equal(b.reload, true);
});

test("each screened candidate reloads — decisions land as the run progresses", () => {
  const at = (n: number) => ({
    tab: "decisions" as const,
    tasks: [task("batch_screen", "running", n, 10, "screen-2")],
    loadFailed: false,
  });
  const a = stepArrival(EMPTY_ARRIVAL_WATCH, at(0));
  const b = stepArrival(a.watch, at(1));
  assert.equal(b.reload, true);
  assert.equal(stepArrival(b.watch, at(1)).reload, false);
});

test("an unreachable queue neither reloads nor forgets what it was watching", () => {
  const a = stepArrival(EMPTY_ARRIVAL_WATCH, {
    tab: "decisions",
    tasks: [task("batch_screen", "running", 2, 10, "screen-3")],
    loadFailed: false,
  });
  const frozen = stepArrival(a.watch, { tab: "decisions", tasks: [], loadFailed: true });
  assert.equal(frozen.reload, false, "a failed poll is not evidence that anything finished");
  assert.deepEqual(frozen.arrival, { mode: "idle" });
  const back = stepArrival(frozen.watch, {
    tab: "decisions",
    tasks: [task("batch_screen", "succeeded", 10, 10, "screen-3")],
    loadFailed: false,
  });
  assert.equal(back.reload, true, "the landing is still caught once the queue is reachable again");
});
