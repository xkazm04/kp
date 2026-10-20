import { test } from "node:test";
import assert from "node:assert/strict";
import { tasksSignature, progressDisplay, type TaskSignatureRow } from "./task-view.ts";

// bug-ui-scan-2026-07-09 #4 (poll-churn signature) + #5 (indeterminate progress).

// ── #4 tasksSignature ──────────────────────────────────────────────────────

const row = (over: Partial<TaskSignatureRow> = {}): TaskSignatureRow => ({
  id: "t1",
  status: "running",
  progressDone: 0,
  progressTotal: 0,
  progressMsg: null,
  label: "Analyze CV",
  error: null,
  startedAt: "2026-07-13T12:00:00.000Z",
  finishedAt: null,
  seenAt: null,
  ...over,
});

test("a mark-seen ack changes the signature (so the unread badge clears on the next poll)", () => {
  const unread = [row({ status: "succeeded", finishedAt: "2026-07-13T12:01:00.000Z" })];
  const seen = [row({ status: "succeeded", finishedAt: "2026-07-13T12:01:00.000Z", seenAt: "2026-07-13T12:02:00.000Z" })];
  assert.notEqual(tasksSignature(unread), tasksSignature(seen));
});

test("an identical poll produces an identical signature (so the commit is skipped)", () => {
  const a = [row(), row({ id: "t2", status: "queued" })];
  const b = [row(), row({ id: "t2", status: "queued" })];
  assert.equal(tasksSignature(a), tasksSignature(b));
});

test("a status change, a progress tick, or an error changes the signature", () => {
  const base = [row()];
  assert.notEqual(tasksSignature(base), tasksSignature([row({ status: "succeeded" })]));
  assert.notEqual(tasksSignature(base), tasksSignature([row({ progressDone: 1, progressTotal: 3 })]));
  assert.notEqual(tasksSignature(base), tasksSignature([row({ progressMsg: "Screening…" })]));
  assert.notEqual(tasksSignature(base), tasksSignature([row({ error: "boom" })]));
});

test("adding or removing a task changes the signature", () => {
  assert.notEqual(tasksSignature([row()]), tasksSignature([row(), row({ id: "t2" })]));
  assert.notEqual(tasksSignature([row(), row({ id: "t2" })]), tasksSignature([row()]));
});

// ── #5 progressDisplay ─────────────────────────────────────────────────────

test("a real total renders a determinate percentage", () => {
  assert.deepEqual(progressDisplay({ status: "running", progressDone: 3, progressTotal: 4 }), {
    mode: "determinate",
    pct: 75,
  });
});

test("a running task with NO total is indeterminate — never a fake constant percent", () => {
  const d = progressDisplay({ status: "running", progressDone: 0, progressTotal: 0 });
  assert.equal(d.mode, "indeterminate");
  assert.equal("pct" in d, false); // must NOT masquerade as a determinate value
});

test("a queued task is idle (no fake motion or percentage)", () => {
  assert.deepEqual(progressDisplay({ status: "queued", progressDone: 0, progressTotal: 0 }), { mode: "idle" });
});

test("determinate percentage is clamped to 0..100", () => {
  assert.deepEqual(progressDisplay({ status: "running", progressDone: 9, progressTotal: 4 }), {
    mode: "determinate",
    pct: 100,
  });
});

// ── challenge-r05 workspace-config-api/B: the replay verdict repaints ─────────

test("two otherwise-identical rows whose replay verdicts differ have different signatures", () => {
  const dead = { status: "failed", finishedAt: "2026-07-13T12:01:00.000Z" };
  const ok = [row({ ...dead, replay: { replayable: true } })];
  const gone = [row({ ...dead, replay: { replayable: false, reason: "inputs-gone" } })];
  const seat = [row({ ...dead, replay: { replayable: false, reason: "no-seat" } })];
  const none = [row({ ...dead, replay: null })];
  assert.notEqual(tasksSignature(ok), tasksSignature(gone));
  assert.notEqual(tasksSignature(gone), tasksSignature(seat));
  assert.notEqual(tasksSignature(ok), tasksSignature(none));
  assert.equal(tasksSignature(gone), tasksSignature([row({ ...dead, replay: { replayable: false, reason: "inputs-gone" } })]));
});
