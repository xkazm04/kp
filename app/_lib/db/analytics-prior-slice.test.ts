// channel-story-complete — the slim prior-window aggregation (pipelineAnalyticsPrior)
// must return EXACTLY what periodDeltas reads off the full pipelineAnalytics battery
// for the prior window, so the payload's `deltas` stay byte-identical after the
// route stops running the full ~9-query battery twice per windowed load. This pins
// the slim function's six compared fields against the full battery's projection over
// a seeded cohort — including the subtle lower-bound-only semantics of the bySource
// (first-event origin) query, which the full battery does NOT upper-bound.
//
// Isolated throwaway DB (testing/unit-db.ts must stay the first project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { pipelineAnalytics, pipelineAnalyticsPrior, type PipelineAnalytics } from "./analytics.ts";
import { createPipelineEntry } from "./pipeline.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const DAY = 86_400_000;

/** Backdate an entry's cohort timestamps + attribution the way real rows carry them. */
function place(id: string, opts: { createdDaysAgo: number; stage: string; channel: string | null; hiredDaysAgo?: number }): void {
  const db = ensureDb();
  const createdAt = new Date(Date.now() - opts.createdDaysAgo * DAY).toISOString();
  const stageChangedAt =
    opts.hiredDaysAgo != null ? new Date(Date.now() - opts.hiredDaysAgo * DAY).toISOString() : createdAt;
  db.prepare(`UPDATE pipeline_entries SET created_at = ?, stage_changed_at = ?, source_channel = ? WHERE id = ?`).run(
    createdAt,
    stageChangedAt,
    opts.channel,
    id
  );
}

/** Project the full battery's payload onto exactly the slim slice's shape. */
function project(a: PipelineAnalytics) {
  return {
    total: a.total,
    hired: a.hired,
    avgTimeToHireDays: a.avgTimeToHireDays,
    funnel: a.funnel.map((f) => ({ stage: f.stage, conversionPct: f.conversionPct })),
    bySource: a.bySource.map((r) => ({ source: r.source, total: r.total, hireRatePct: r.hireRatePct })),
    byChannel: a.byChannel.map((r) => ({
      channel: r.channel,
      total: r.total,
      hireRatePct: r.hireRatePct,
      costPerApplicantCzk: r.costPerApplicantCzk,
    })),
  };
}

test("pipelineAnalyticsPrior matches the full battery's compared scalars over the prior window", () => {
  // endMs 10 days in the past → the prior window is [now-40d, now-10d). An entry
  // created 5 days ago falls AFTER the window's upper bound: excluded from the
  // cohort (total/hired/byChannel) but INCLUDED in bySource (lower-bound only) — the
  // exact asymmetry the slim function must reproduce.
  const windowDays = 30;
  const endMs = Date.now() - 10 * DAY;

  const a = createPipelineEntry({ candidateId: "ps-a", candidateLabel: "A Hire", jobId: "ps-job", jobTitle: "Backend Engineer", stage: "Hired", sourceChannel: "apply" }).entry;
  place(a.id, { createdDaysAgo: 20, stage: "Hired", channel: "apply", hiredDaysAgo: 12 });

  const b = createPipelineEntry({ candidateId: "ps-b", candidateLabel: "B Screened", jobId: "ps-job", jobTitle: "Backend Engineer", stage: "Screened", sourceChannel: "boards" }).entry;
  place(b.id, { createdDaysAgo: 35, stage: "Screened", channel: "boards" });

  const c = createPipelineEntry({ candidateId: "ps-c", candidateLabel: "C After", jobId: "ps-job", jobTitle: "Backend Engineer", stage: "Interview", sourceChannel: "apply" }).entry;
  place(c.id, { createdDaysAgo: 5, stage: "Interview", channel: "apply" });

  const d = createPipelineEntry({ candidateId: "ps-d", candidateLabel: "D Old", jobId: "ps-job", jobTitle: "Backend Engineer", stage: "Screened", sourceChannel: "rediscovery" }).entry;
  place(d.id, { createdDaysAgo: 50, stage: "Screened", channel: "rediscovery" });

  const full = pipelineAnalytics(windowDays, { endMs }, undefined);
  const slim = pipelineAnalyticsPrior(windowDays, endMs, undefined);

  assert.deepEqual(slim, project(full), "slim prior slice diverged from the full battery's compared fields");
  // Guard the test is actually exercising a non-empty cohort (not vacuously equal).
  assert.ok(full.total >= 2, "expected the seeded in-window cohort to contribute rows");
  assert.ok(full.bySource.length >= 1, "expected at least one first-touch origin bucket");
});
