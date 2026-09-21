// The scheduler JOB REGISTRY (scheduler-jobs.ts) is the one authority the clock loop,
// the schedule route and the SchedulerControl panel iterate. These pin what each of
// those consumers silently relies on: names are unique and typed, every job's label
// resolves in every catalog (a registered job with no label is an empty chip in three
// languages), and `jobseeker_scan` starts DISABLED and gated behind a verified run —
// a crawler cadence is a courtesy decision an operator must make after seeing one
// scan succeed, never a default.
//
// Runner: node:test, via `npm run test:unit`. Pure — no DB, no Next runtime.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEDULER_JOBS, SCHEDULER_JOB_NAMES, isSchedulerJobName, schedulerJob } from "./scheduler-jobs.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCALES = ["en", "cs", "de", "fr"] as const;

test("registry names are unique, and the name list and the definitions agree", () => {
  const names = SCHEDULER_JOBS.map((j) => j.name);
  assert.equal(new Set(names).size, names.length, "a duplicated job name would make claimDueRun fire two handlers off one row");
  assert.deepEqual([...names].sort(), [...SCHEDULER_JOB_NAMES].sort(), "SCHEDULER_JOB_NAMES and SCHEDULER_JOBS must list the same jobs");
  for (const name of SCHEDULER_JOB_NAMES) assert.ok(isSchedulerJobName(name));
  assert.equal(isSchedulerJobName("price_reconcile"), false, "a clock sweep that is not registered is not a registry job");
  assert.equal(isSchedulerJobName(undefined), false);
});

test("the two historical jobs keep their defaults (behaviour-preserving)", () => {
  const policy = schedulerJob("policy_pass");
  assert.equal(policy.defaultEnabled, false, "the policy pass is opt-in");
  assert.equal(policy.defaultIntervalMinutes, 15);
  assert.equal(policy.requiresVerifiedRun, false);
  const reminders = schedulerJob("reminders");
  assert.equal(reminders.defaultEnabled, true, "registering reminders must not silently stop candidate reminders");
  assert.equal(reminders.defaultIntervalMinutes, 1, "the historical every-minute cadence");
});

test("jobseeker_scan is registered DISABLED, twice daily, and gated behind a verified run", () => {
  const scan = schedulerJob("jobseeker_scan");
  assert.equal(scan.defaultEnabled, false, "a created schedule is not consent to crawl tonight");
  assert.equal(scan.defaultIntervalMinutes, 720);
  assert.equal(scan.requiresVerifiedRun, true, "the route refuses to arm it before one ok run (JOBSEEKER_SCAN_UNVERIFIED)");
  assert.equal(scan.fanOut, "per-workspace");
  assert.equal(scan.labelKey, "jobseekerScan");
});

test("every job's label resolves in all four catalogs, and the unverified title exists beside them", () => {
  for (const locale of LOCALES) {
    const messages = JSON.parse(readFileSync(path.join(root, "messages", `${locale}.json`), "utf8")) as {
      pipeline: { scheduler: { job: Record<string, string>; unverified: string; jobStatus: Record<string, string> } };
    };
    const sched = messages.pipeline.scheduler;
    for (const job of SCHEDULER_JOBS) {
      assert.ok((sched.job?.[job.labelKey]?.length ?? 0) > 0, `${locale}: pipeline.scheduler.job.${job.labelKey} must exist for ${job.name}`);
    }
    assert.ok((sched.unverified?.length ?? 0) > 0, `${locale}: pipeline.scheduler.unverified must exist (the disabled toggle's title)`);
    // The generic row renders every status the store can write (recordRun's union).
    for (const status of ["ok", "error", "skipped"]) {
      assert.ok((sched.jobStatus?.[status]?.length ?? 0) > 0, `${locale}: pipeline.scheduler.jobStatus.${status} must exist`);
    }
  }
});

test("an unregistered name throws at the registry, not somewhere downstream", () => {
  assert.throws(() => schedulerJob("price_reconcile" as never), /not registered/);
});
