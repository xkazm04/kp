// Behavioral coverage for scheduler-store.ts + scheduler.ts against an ISOLATED
// throwaway DB (testing/unit-db.ts must stay the first project import). Pins the
// durable-clock contract: default-off job creation, the atomic claim (exactly one
// winner per due window), interval clamping, the forced-run clock advance, run
// logging, and that a disabled clock never runs the pass.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import {
  advanceAfterForcedRun,
  claimDueRun,
  ensureReminderJob,
  ensureSchedule,
  getSchedule,
  listRuns,
  POLICY_JOB,
  recordRun,
  setEnabled,
  setIntervalMinutes,
} from "./scheduler-store.ts";
import { tickScheduler } from "./scheduler.ts";

after(() => cleanupUnitDb());

test("ensureSchedule creates a job OFF by default and never alters an existing row", () => {
  const created = ensureSchedule("t_default");
  assert.equal(created.enabled, false, "nothing auto-mutates data unless opted in");
  assert.equal(created.intervalMinutes, 15);
  assert.equal(created.nextDueAt, null);

  // Defaults only apply at FIRST creation — re-ensuring with different defaults
  // must not flip an existing job.
  const reEnsured = ensureSchedule("t_default", { enabled: true, intervalMinutes: 1 });
  assert.equal(reEnsured.enabled, false);
  assert.equal(reEnsured.intervalMinutes, 15);
});

test("the reminders job is born ON at its historical 1-minute cadence", () => {
  const reminders = ensureReminderJob();
  assert.equal(reminders.enabled, true);
  assert.equal(reminders.intervalMinutes, 1);
});

test("claimDueRun: disabled → never claims; enabled → exactly one winner per due window", () => {
  ensureSchedule("t_claim");
  assert.equal(claimDueRun("t_claim"), false, "a disabled job can never be claimed");

  setEnabled("t_claim", true); // enabling makes it due immediately
  assert.equal(claimDueRun("t_claim"), true, "the first claim of a due window wins");
  assert.equal(claimDueRun("t_claim"), false, "the same window cannot be claimed twice");
  const sched = getSchedule("t_claim");
  assert.ok(sched.lastRunAt, "the claim stamps last_run_at");
  assert.ok(Date.parse(sched.nextDueAt!) > Date.now(), "the claim advances next_due_at into the future");

  // Disabling clears the pending window entirely.
  assert.equal(setEnabled("t_claim", false).nextDueAt, null);
});

test("setIntervalMinutes clamps to [1, 1440] and never lets NaN wedge the clock", () => {
  ensureSchedule("t_interval");
  assert.equal(setIntervalMinutes("t_interval", Number.NaN).intervalMinutes, 15, "NaN falls back to the default");
  assert.equal(setIntervalMinutes("t_interval", -5).intervalMinutes, 1);
  assert.equal(setIntervalMinutes("t_interval", 999_999).intervalMinutes, 1440);
  assert.equal(getSchedule("t_interval").nextDueAt, null, "a disabled job keeps next_due_at null");

  // On an enabled job a tightened cadence re-anchors the pending run (never past).
  setEnabled("t_interval", true);
  claimDueRun("t_interval");
  const next = setIntervalMinutes("t_interval", 1).nextDueAt!;
  assert.ok(Date.parse(next) >= Date.now() - 1000, "next run is never scheduled into the past");
  assert.ok(Date.parse(next) <= Date.now() + 70_000, "a 1-minute cadence fires within about a minute");
});

test("advanceAfterForcedRun advances the clock only for an enabled job", () => {
  ensureSchedule("t_force");
  advanceAfterForcedRun("t_force");
  assert.equal(getSchedule("t_force").nextDueAt, null, "a manual run while OFF must not arm the clock");

  setEnabled("t_force", true);
  claimDueRun("t_force");
  const before = getSchedule("t_force").nextDueAt!;
  advanceAfterForcedRun("t_force");
  const after_ = getSchedule("t_force").nextDueAt!;
  assert.ok(Date.parse(after_) >= Date.parse(before), "the forced advance re-arms the window");
  assert.ok(Date.parse(after_) > Date.now());
});

test("recordRun persists the durable run log and the last-ok summary", () => {
  // The job row must exist for the lastSummary snapshot to land (tickScheduler
  // always ensures it before recording — mirror that).
  ensureSchedule("t_log");
  recordRun({
    job: "t_log",
    trigger: "manual",
    status: "ok",
    summary: { advanced: 2 },
    decisions: [{ id: "e1", action: "hold" }],
    startedAt: new Date().toISOString(),
  });
  recordRun({ job: "t_log", status: "error", error: "boom", startedAt: new Date().toISOString() });

  const runs = listRuns(10, "t_log");
  assert.equal(runs.length, 2);
  const ok = runs.find((r) => r.status === "ok")!;
  assert.deepEqual(ok.summary, { advanced: 2 });
  assert.deepEqual(ok.decisions, [{ id: "e1", action: "hold" }]);
  assert.equal(ok.trigger, "manual");
  const err = runs.find((r) => r.status === "error")!;
  assert.equal(err.error, "boom");
  // Only the OK run updates the schedule's lastSummary snapshot.
  assert.deepEqual(getSchedule("t_log").lastSummary, { advanced: 2 });
});

test("tickScheduler on a disabled policy job neither runs the pass nor logs a run", async () => {
  ensureSchedule(); // POLICY_JOB, disabled by default (no AUTOSTART in tests)
  assert.equal(getSchedule(POLICY_JOB).enabled, false);
  const result = await tickScheduler();
  assert.deepEqual(result, { ran: false });
  assert.equal(listRuns(10, POLICY_JOB).length, 0, "no scheduler_runs row for a tick that never claimed");
});
