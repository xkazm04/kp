// The ROI ledger's "median" time-to-hire tile must show an actual median
// (analytics-calibration-dashboards #1). pipelineAnalytics exposes both
// avgTimeToHireDays (mean) and medianTimeToHireDays (median); on a right-skewed
// sample they diverge sharply, so the tile that claims "median" must not quote the
// mean. Scoped to an isolated workspace so the unit DB's demo seed doesn't pollute
// the sample. (testing/unit-db.ts must be the first project import.)
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pipelineAnalytics } from "./analytics.ts";
import { createPipelineEntry } from "./pipeline.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const DAY = 86_400_000;
const WS = "median-tth-ws";

function hire(id: string, tthDays: number) {
  const { entry } = createPipelineEntry({ candidateId: id, candidateLabel: id, jobId: "med-job", jobTitle: "Role", stage: "Hired", workspaceId: WS });
  // TTH = stage_changed_at - created_at. Anchor hired at 2 days ago so all fall in any window.
  const createdAt = new Date(Date.now() - (tthDays + 2) * DAY).toISOString();
  const stageChangedAt = new Date(Date.now() - 2 * DAY).toISOString();
  ensureDb().prepare(`UPDATE pipeline_entries SET created_at = ?, stage_changed_at = ? WHERE id = ?`).run(createdAt, stageChangedAt, entry.id);
}

test("medianTimeToHireDays is the median, not the right-skewed mean", () => {
  // Samples 5,6,7,8,60 → median 7, mean 17.2 → 17. The tile is labeled "median".
  for (const [i, tth] of [5, 6, 7, 8, 60].entries()) hire(`med-${i}`, tth);
  const a = pipelineAnalytics(undefined, undefined, WS);
  assert.equal(a.medianTimeToHireDays, 7, "median of {5,6,7,8,60} is 7");
  assert.equal(a.avgTimeToHireDays, 17, "mean is a very different 17 — quoting it under a 'median' label would be wrong");
});

test("both statistics are null when there are no hires in the workspace", () => {
  const a = pipelineAnalytics(undefined, undefined, "median-tth-empty-ws");
  assert.equal(a.medianTimeToHireDays, null);
  assert.equal(a.avgTimeToHireDays, null);
  assert.equal(a.timeToHireSamples, 0, "no sample, and it says 0 rather than leaving the reader to assume `hired`");
});

// THE SAMPLE IS NOT `hired`. A terminal entry with no stage_changed_at is a real hire
// the duration sample cannot contain — it is exactly the shape the shipped corpus has
// (4 of its 9 terminal entries), and every path in pipeline.ts that deliberately leaves
// stage_changed_at alone produces another one. A consumer that publishes the median
// alongside `hired` therefore claims a sample it does not have; the metric pack does
// precisely that, clearing its MIN_SAMPLE floor on observations that were never made.
const NARROW_WS = "median-tth-narrow-ws";

test("setup — 5 hires with both timestamps and 4 terminal entries with none", () => {
  for (const [i, tth] of [5, 6, 7, 8, 60].entries()) {
    const { entry } = createPipelineEntry({
      candidateId: `nar-${i}`,
      candidateLabel: `nar-${i}`,
      jobId: "nar-job",
      jobTitle: "Role",
      stage: "Hired",
      workspaceId: NARROW_WS,
    });
    ensureDb()
      .prepare(`UPDATE pipeline_entries SET created_at = ?, stage_changed_at = ? WHERE id = ?`)
      .run(new Date(Date.now() - (tth + 2) * DAY).toISOString(), new Date(Date.now() - 2 * DAY).toISOString(), entry.id);
  }
  for (let i = 0; i < 4; i += 1) {
    const { entry } = createPipelineEntry({
      candidateId: `nar-null-${i}`,
      candidateLabel: `nar-null-${i}`,
      jobId: "nar-job",
      jobTitle: "Role",
      stage: "Hired",
      workspaceId: NARROW_WS,
    });
    ensureDb().prepare(`UPDATE pipeline_entries SET stage_changed_at = NULL WHERE id = ?`).run(entry.id);
  }
});

test("the payload states the sample the median actually covers, not the hire count", () => {
  const a = pipelineAnalytics(undefined, undefined, NARROW_WS);
  assert.equal(a.hired, 9, "nine entries stand on the terminal stage");
  assert.equal(a.timeToHireSamples, 5, "…but only five carry both timestamps the duration needs");
  assert.equal(a.medianTimeToHireDays, 7, "the median is the median of those five");
  assert.notEqual(
    a.timeToHireSamples,
    a.hired,
    "the two counts diverge silently — publishing the median with `hired` as its sample is the defect"
  );
});
