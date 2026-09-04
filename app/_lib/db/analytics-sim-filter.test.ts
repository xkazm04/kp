// gsim-l2-105 / REC-11 — the guided demo writes REAL pipeline rows whose job
// title carries the (SIM) marker; live aggregates must ignore that residue so a
// demo run can never move a leadership metric ("1 candidate hired this week",
// funnel, ROI, cost-per-hire). The board reads (listPipeline → /api/pipeline)
// stay UNFILTERED on purpose — the running sim observes its own rows there and
// they render visibly marked. Isolated throwaway DB (testing/unit-db.ts must
// stay the first project import); ensureDb seeds a demo dataset, so every
// assertion is a DELTA against the pre-insert snapshot.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { SIM_MARKER } from "@/app/features/shell/simulation/constants";
import { pipelineAnalytics } from "./analytics.ts";
import { createPipelineEntry, listPipeline } from "./pipeline.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

test("pipelineAnalytics ignores (SIM) rows in every aggregate; the board still shows them to the sim", () => {
  const before = pipelineAnalytics();
  const windowedBefore = pipelineAnalytics(7);
  const simTitle = `Backend Engineer ${SIM_MARKER}`;

  const real = createPipelineEntry({
    candidateId: "ana-real",
    candidateLabel: "Real Hire",
    jobId: "ana-job-real",
    jobTitle: "Backend Engineer",
    stage: "Hired",
  }).entry;
  // NULL job titles are real data (legacy/degraded rows) — the sim filter must
  // never eat them (SQL `NOT LIKE` alone would: NULL NOT LIKE x is NULL). The
  // create API requires a title, so null the column the way old data carries it.
  const untitled = createPipelineEntry({
    candidateId: "ana-untitled",
    candidateLabel: "No Job Title",
    jobId: "ana-job-untitled",
    jobTitle: "placeholder",
    stage: "Screened",
  }).entry;
  ensureDb().prepare(`UPDATE pipeline_entries SET job_title = NULL WHERE id = ?`).run(untitled.id);
  ensureDb().prepare(`UPDATE pipeline_events SET job_title = NULL WHERE entry_id = ?`).run(untitled.id);
  const sim = createPipelineEntry({
    candidateId: "ana-sim",
    candidateLabel: "Demo Resident",
    jobId: "ana-job-sim",
    jobTitle: simTitle,
    stage: "Hired",
  }).entry;

  const a = pipelineAnalytics();
  assert.equal(a.total, before.total + 2, "only the real + null-title entries join the cohort — never the sim row");
  assert.equal(a.hired, before.hired + 1, "a demo 'hire' must never count as hired");
  assert.equal(a.funnel[0].reached, before.funnel[0].reached + 2, "the funnel top counts only real entries");
  assert.equal(
    a.funnel[a.funnel.length - 1].reached,
    before.funnel[before.funnel.length - 1].reached + 1,
    "the funnel's Hired step counts only the real hire"
  );
  assert.ok(!a.byJob.some((j) => j.jobTitle === simTitle), "no (SIM) role may appear in the by-job table");
  // The event-fed rollups exclude sim events too: exactly the two real 'added'
  // events land as human actions (the sim entry's 'added' is filtered out).
  assert.equal(a.automation.humanCount, before.automation.humanCount + 2, "sim events must not enter the automation rollup");

  // Windowed view applies the same exclusion.
  const windowed = pipelineAnalytics(7);
  assert.equal(windowed.total, windowedBefore.total + 2);
  assert.equal(windowed.hired, windowedBefore.hired + 1);

  // The sim's own reads are NOT filtered: the demo drives the real board and
  // must keep seeing the rows it created (visibly marked with "(SIM)").
  const boardIds = new Set(listPipeline().map((e) => e.id));
  assert.ok(boardIds.has(sim.id), "the board still surfaces sim rows for the running demo");
  assert.ok(boardIds.has(real.id) && boardIds.has(untitled.id));
});

// The exclusion above is right; its SILENCE was the defect. The board shows the demo
// rows, every figure on the Insights tab drops them, and nothing on screen said so —
// so after a guided run the funnel and the board disagreed and the reader had to guess
// which one was lying. `excludedSim` is the size of that gap, and the tab renders a
// footnote from it (AnalyticsHeader). A COUNT, never the rows.
test("pipelineAnalytics reports how many sim rows it excluded", () => {
  const before = pipelineAnalytics();
  const windowedBefore = pipelineAnalytics(7);
  const simTitle = `Data Analyst ${SIM_MARKER}`;

  createPipelineEntry({
    candidateId: "ana-count-real",
    candidateLabel: "Real Applicant",
    jobId: "ana-job-count-real",
    jobTitle: "Data Analyst",
    stage: "Screened",
  });
  const untitled = createPipelineEntry({
    candidateId: "ana-count-untitled",
    candidateLabel: "No Job Title Either",
    jobId: "ana-job-count-untitled",
    jobTitle: "placeholder",
    stage: "Screened",
  }).entry;
  ensureDb().prepare(`UPDATE pipeline_entries SET job_title = NULL WHERE id = ?`).run(untitled.id);
  for (let i = 0; i < 3; i += 1) {
    createPipelineEntry({
      candidateId: `ana-count-sim-${i}`,
      candidateLabel: `Demo Resident ${i}`,
      jobId: `ana-job-count-sim-${i}`,
      jobTitle: simTitle,
      stage: "Screened",
    });
  }

  const a = pipelineAnalytics();
  assert.equal(a.excludedSim, before.excludedSim + 3, "the three demo rows the aggregates dropped are counted");
  assert.equal(a.total, before.total + 2, "and they are still dropped from every figure");
  // The inverse predicate must be NULL-safe the same way `notSim` is: a title-less
  // real entry belongs to NEITHER side, or the footnote would accuse real data.
  assert.equal(
    pipelineAnalytics(7).excludedSim,
    windowedBefore.excludedSim + 3,
    "the count is windowed exactly like the figures it explains",
  );
});
