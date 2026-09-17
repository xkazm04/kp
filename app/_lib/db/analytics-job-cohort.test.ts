// pipelineAnalytics has a job dimension: opts.jobId scopes the cohort SELECT,
// the sim-exclusion COUNT, and the event-time hire count so funnel / median TTH /
// cost-per-hire can answer one role without a second aggregator. An omitted jobId
// keeps the workspace-wide figures. (testing/unit-db.ts must be the first project
// import.)
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pipelineAnalytics } from "./analytics.ts";
import { createPipelineEntry } from "./pipeline.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const DAY = 86_400_000;
const WS = "job-cohort-ws";
const JOB_A = "job-cohort-a";
const JOB_B = "job-cohort-b";
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function place(opts: {
  id: string;
  jobId: string;
  title: string;
  stage: string;
  createdDaysAgo: number;
  closedDaysAgo?: number;
}): void {
  const { entry } = createPipelineEntry({
    candidateId: opts.id,
    candidateLabel: opts.id,
    jobId: opts.jobId,
    jobTitle: opts.title,
    stage: opts.stage,
    workspaceId: WS,
  });
  const createdAt = iso(opts.createdDaysAgo * DAY);
  const stageChangedAt =
    opts.closedDaysAgo != null ? iso(opts.closedDaysAgo * DAY) : createdAt;
  const db = ensureDb();
  db.prepare(`UPDATE pipeline_entries SET created_at = ?, stage_changed_at = ? WHERE id = ?`).run(
    createdAt,
    stageChangedAt,
    entry.id
  );
  if (opts.stage === "Hired" && opts.closedDaysAgo != null) {
    db.prepare(
      `INSERT INTO pipeline_events (entry_id, candidate_label, job_title, kind, from_stage, to_stage, created_at, workspace_id)
       VALUES (?, ?, ?, 'advanced', 'Offer', 'Hired', ?, ?)`
    ).run(entry.id, opts.id, opts.title, iso(opts.closedDaysAgo * DAY), WS);
  }
}

test("setup — two roles in one workspace, distinct TTH and hire events", () => {
  place({ id: "a-screen-1", jobId: JOB_A, title: "Role A", stage: "Screened", createdDaysAgo: 5 });
  place({ id: "a-screen-2", jobId: JOB_A, title: "Role A", stage: "Screened", createdDaysAgo: 4 });
  // TTH 10 days (created 12d ago, closed 2d ago).
  place({ id: "a-hire", jobId: JOB_A, title: "Role A", stage: "Hired", createdDaysAgo: 12, closedDaysAgo: 2 });
  // TTH 40 days (created 42d ago, closed 2d ago) — outside a 30-day creation cohort.
  place({ id: "b-hire", jobId: JOB_B, title: "Role B", stage: "Hired", createdDaysAgo: 42, closedDaysAgo: 2 });
});

test("an omitted jobId matches the workspace-wide figures and echoes jobId: null", () => {
  const wide = pipelineAnalytics(null, undefined, WS);
  const emptyOpts = pipelineAnalytics(null, {}, WS);
  assert.equal(wide.jobId, null);
  assert.equal(emptyOpts.jobId, null);
  assert.equal(wide.total, emptyOpts.total);
  assert.equal(wide.hired, emptyOpts.hired);
  assert.equal(wide.medianTimeToHireDays, emptyOpts.medianTimeToHireDays);
  assert.equal(wide.hiresClosedInWindow, emptyOpts.hiresClosedInWindow);
  assert.deepEqual(
    wide.funnel.map((f) => f.current),
    emptyOpts.funnel.map((f) => f.current)
  );
  assert.equal(wide.total, 4, "both roles: 2 screened + 2 hired");
  assert.equal(wide.hired, 2);
});

test("funnel, median TTH and closed-hire count honour opts.jobId", () => {
  const a = pipelineAnalytics(null, { jobId: JOB_A }, WS);
  const b = pipelineAnalytics(null, { jobId: JOB_B }, WS);
  const wide = pipelineAnalytics(null, undefined, WS);

  assert.equal(a.jobId, JOB_A);
  assert.equal(b.jobId, JOB_B);

  assert.equal(a.total, 3, "role A: two screened + one hire");
  assert.equal(b.total, 1, "role B: one hire");
  assert.equal(a.total + b.total, wide.total);
  assert.equal(a.hired, 1);
  assert.equal(b.hired, 1);

  const hiredCurrent = (p: typeof a) => p.funnel.find((f) => f.stage === "Hired")?.current ?? 0;
  assert.equal(hiredCurrent(a), 1);
  assert.equal(hiredCurrent(b), 1);
  assert.equal(hiredCurrent(a) + hiredCurrent(b), hiredCurrent(wide));

  // Samples {10} vs {40} vs {10, 40}.
  assert.equal(a.medianTimeToHireDays, 10);
  assert.equal(b.medianTimeToHireDays, 40);
  assert.equal(wide.medianTimeToHireDays, 25);

  assert.equal(a.hiresClosedInWindow, 1);
  assert.equal(b.hiresClosedInWindow, 1);
  assert.equal(wide.hiresClosedInWindow, 2);
});

test("a 30-day window's event-time hire count is job-scoped too", () => {
  // Role B's hire was CREATED 42 days ago, so it drops out of the creation cohort,
  // but the terminal transition landed 2 days ago — in the window. Job-scoped
  // hiresClosedInWindow must still see it, and must not see role A's.
  const a = pipelineAnalytics(30, { jobId: JOB_A }, WS);
  const b = pipelineAnalytics(30, { jobId: JOB_B }, WS);
  const wide = pipelineAnalytics(30, undefined, WS);

  assert.equal(a.hired, 1, "role A hire was created inside the window");
  assert.equal(b.hired, 0, "role B hire is outside the creation cohort");
  assert.equal(a.hiresClosedInWindow, 1);
  assert.equal(b.hiresClosedInWindow, 1, "role B still CLOSED in the window");
  assert.equal(wide.hiresClosedInWindow, 2);
  assert.equal(a.hiresClosedInWindow + b.hiresClosedInWindow, wide.hiresClosedInWindow);
});
