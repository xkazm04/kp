// pipelineAnalytics has a job dimension: opts.jobId scopes the cohort SELECT,
// the sim-exclusion COUNT, and the event-time hire count so funnel / median TTH /
// cost-per-hire can answer one role without a second aggregator. An omitted jobId
// keeps the workspace-wide figures. (testing/unit-db.ts must be the first project
// import.)
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pipelineAnalytics, pipelineAnalyticsPrior } from "./analytics.ts";
import { createPipelineEntry } from "./pipeline.ts";
import { setChannelSpend } from "./channels.ts";
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

// ---------------------------------------------------------------------------
// challenge r04 analytics-dashboard/B — the EVENT half of the role axis, and the
// figures that cannot be scoped at all.
//
// Event reads (momentum, the kindCounts behind automation + offers, the hold pair)
// join to the role through entry_id → pipeline_entries.job_id. Everything the join
// cannot reach is WITHHELD BY NAME in payload.jobScope.withheld: workspace-wide channel
// spend and the account-wide LLM ledger are never divided by one role's hires, and
// ko_declined events (entry_id NULL) cannot be split by role at all.
// ---------------------------------------------------------------------------

const entryIdOf = (candidateId: string): string =>
  (ensureDb().prepare(`SELECT id FROM pipeline_entries WHERE candidate_id = ? AND workspace_id = ?`).get(candidateId, WS) as { id: string }).id;

function event(kind: string, candidateId: string | null, title: string, daysAgo = 1): void {
  ensureDb()
    .prepare(
      `INSERT INTO pipeline_events (entry_id, candidate_label, job_title, kind, created_at, workspace_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(candidateId ? entryIdOf(candidateId) : null, candidateId, title, kind, iso(daysAgo * DAY), WS);
}

const countEvents = (kind: string, jobId: string | null): number =>
  Number(
    (
      ensureDb()
        .prepare(
          jobId
            ? `SELECT COUNT(*) AS n FROM pipeline_events WHERE kind = ? AND workspace_id = ? AND entry_id IN (SELECT id FROM pipeline_entries WHERE job_id = ?)`
            : `SELECT COUNT(*) AS n FROM pipeline_events WHERE kind = ? AND workspace_id = ?`
        )
        .get(...(jobId ? [kind, WS, jobId] : [kind, WS])) as { n: number }
    ).n
  );

test("setup — role events, spend, a metered call, KO declines and two same-titled reqs", () => {
  event("offer_sent", "a-hire", "Role A");
  event("offer_sent", "b-hire", "Role B");
  event("offer_sent", "b-hire", "Role B");
  event("auto_advanced", "a-screen-1", "Role A");
  event("auto_rejected", "b-hire", "Role B");
  event("screening_hold", "b-hire", "Role B", 3);
  // Entry-less knockout discards: two under Role A's title, one under the twin title.
  event("ko_declined", null, "Role A");
  event("ko_declined", null, "Role A");
  event("ko_declined", null, "Role Twin");
  place({ id: "twin-1", jobId: "job-twin-1", title: "Role Twin", stage: "Screened", createdDaysAgo: 3 });
  place({ id: "twin-2", jobId: "job-twin-2", title: "Role Twin", stage: "Screened", createdDaysAgo: 3 });
  const db = ensureDb();
  db.prepare(`UPDATE pipeline_entries SET source_channel = 'linkedin' WHERE id = ?`).run(entryIdOf("b-hire"));
  db.prepare(`UPDATE pipeline_entries SET source_channel = 'jobs.cz' WHERE id = ?`).run(entryIdOf("a-hire"));
  setChannelSpend("linkedin", 50_000, WS);
  db.prepare(
    `INSERT INTO llm_usage (ts, use_case, provider, model, cost_usd, source) VALUES (?, 'test', 'test', 'm', 4.0, 'test')`
  ).run(iso(DAY));
});

test("momentum, automation and offers count ONLY the scoped role's events (joined through entry_id)", () => {
  const a = pipelineAnalytics(null, { jobId: JOB_A }, WS);
  const b = pipelineAnalytics(null, { jobId: JOB_B }, WS);
  const wide = pipelineAnalytics(null, undefined, WS);

  assert.equal(a.offers.extended, 1);
  assert.equal(b.offers.extended, 2);
  assert.equal(wide.offers.extended, 3);

  assert.equal(a.automation.autoAdvanced, 1);
  assert.equal(a.automation.autoRejected, 0);
  assert.equal(b.automation.autoRejected, 1);
  assert.equal(a.automation.holdsRaised, 0, "role B's hold is not role A's");
  assert.equal(b.automation.holdsRaised, 1);
  assert.equal(wide.automation.holdsRaised, 1);

  const added = (p: typeof a) => p.momentum.reduce((s, w) => s + w.added, 0);
  const advanced = (p: typeof a) => p.momentum.reduce((s, w) => s + w.advanced, 0);
  assert.equal(added(a), countEvents("added", JOB_A), "momentum inflow is role A's own adds");
  assert.equal(added(wide), countEvents("added", null));
  assert.equal(advanced(a), 1, "role A's auto-advance; role B's hire transition is not in it");
});

test("a job-scoped read withholds every unscopable figure BY NAME — never a divided or silent number", () => {
  const wide = pipelineAnalytics(null, undefined, WS);
  const a = pipelineAnalytics(null, { jobId: JOB_A }, WS);

  // The workspace view states no scope and publishes its costs.
  assert.equal(wide.jobScope, null);
  assert.notEqual(wide.costPerHireCzk, null, "fixture: workspace spend ÷ workspace hires is a real figure");
  assert.notEqual(wide.computeCost?.costPerHireUsd ?? null, null, "fixture: a metered call and hires to divide by");
  assert.ok(wide.bySource.length > 0);
  assert.equal(wide.koDeclined, 3);

  assert.deepEqual(a.jobScope, {
    jobId: JOB_A,
    jobTitle: "Role A",
    withheld: [
      { figure: "bySource", reason: "workspaceOnly" },
      { figure: "channelDecisionTime", reason: "workspaceOnly" },
      { figure: "channelSpend", reason: "workspaceSpend" },
      { figure: "costPerHire", reason: "workspaceSpend" },
      { figure: "computeCostPerHire", reason: "accountLedger" },
      { figure: "koDeclined", reason: "noEntry" },
    ],
  });
  assert.equal(a.costPerHireCzk, null, "workspace spend is never divided by one role's hires");
  assert.equal(a.costPerHireAsOf, null);
  assert.notEqual(a.computeCost, null, "the ledger total still shows, labelled account-wide");
  assert.equal(a.computeCost?.costPerHireUsd, null, "the account ledger is never divided by one role's hires");
  assert.deepEqual(a.bySource, []);
  assert.equal(a.koDeclined, 0, "withheld — the header names it; nothing renders the zero");
  for (const ch of a.byChannel) {
    assert.equal(ch.spendCzk, null, `${ch.channel}: spend withheld`);
    assert.equal(ch.spendUpdatedAt, null);
    assert.equal(ch.costPerApplicantCzk, null);
    assert.equal(ch.costPerHireCzk, null);
    assert.equal(ch.medianHoursToDecision, null);
  }
  assert.ok(!a.byChannel.some((c) => c.channel === "linkedin"), "a spend-only channel row is workspace spend, not this role's");
  assert.deepEqual(a.byChannel.map((c) => [c.channel, c.total]), [["jobs.cz", 1]], "the role's own channel volume still scopes");
  assert.deepEqual(
    a.byJob.map((j) => [j.jobId, j.koDeclined]),
    [[JOB_A, null]],
    "the role row's KO column is withheld, not zero"
  );

  const unknown = pipelineAnalytics(null, { jobId: "no-such-job" }, WS);
  assert.equal(unknown.total, 0);
  assert.equal(unknown.jobScope?.jobTitle, null, "an id this workspace cannot see names no title");
});

test("byJob keys by job id: two reqs sharing one title are two rows, and their title-keyed KO count is not split", () => {
  const wide = pipelineAnalytics(null, undefined, WS);
  const twins = wide.byJob.filter((j) => j.jobTitle === "Role Twin");
  assert.equal(twins.length, 2, "same title, two requisitions — two rows");
  assert.deepEqual(twins.map((j) => j.jobId).sort(), ["job-twin-1", "job-twin-2"]);
  for (const t of twins) {
    assert.equal(t.total, 1);
    assert.equal(t.koDeclined, null, "one title-keyed KO count cannot be attributed to either twin");
  }
  const a = wide.byJob.find((j) => j.jobId === JOB_A);
  assert.equal(a?.koDeclined, 2, "a title that names exactly one req keeps its KO count");
  assert.equal(a?.total, 3);
  assert.equal(wide.byJobTotal, wide.byJob.length);
});

test("the prior-window slice takes the role axis, so deltas compare the role with itself", () => {
  const endMs = Date.now() - 30 * DAY;
  // Role B's hire was created 42 days ago — inside [60d, 30d) — role A has nothing there.
  const a = pipelineAnalyticsPrior(30, endMs, WS, { jobId: JOB_A });
  const b = pipelineAnalyticsPrior(30, endMs, WS, { jobId: JOB_B });
  const wide = pipelineAnalyticsPrior(30, endMs, WS);
  assert.equal(a.total, 0);
  assert.equal(b.total, 1);
  assert.equal(wide.total, 1);
  assert.deepEqual(b.bySource, [], "withheld under a role, on both sides of the delta");
  // Byte-identity with the full battery holds under the role axis too.
  const full = pipelineAnalytics(30, { endMs, jobId: JOB_B }, WS);
  assert.equal(full.total, b.total);
  assert.equal(full.hired, b.hired);
  assert.equal(full.avgTimeToHireDays, b.avgTimeToHireDays);
});
