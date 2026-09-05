// The analytics cohort read is BOUNDED, and says when it hit the bound.
//
// `pipelineAnalytics` and `pipelineAnalyticsPrior` both pulled EVERY matching
// pipeline_entries row into memory and aggregated in JS — an all-time view on a
// deployment with a large board is a full-table read per Insights load, twice
// (current + prior window), with no ceiling anywhere on the path. The cap is the
// bound; `truncated` is the honesty that must travel with it, because a funnel
// computed over the first N of M rows is a DIFFERENT number from the one the
// page claims to show, and a silent cut is the failure mode that number has.
//
// Isolated throwaway DB (testing/unit-db.ts must stay the first project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ANALYTICS_COHORT_CAP, pipelineAnalytics, pipelineAnalyticsPrior } from "./analytics.ts";
import { createPipelineEntry } from "./pipeline.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const DAY = 86_400_000;

/** Five entries in the recent cohort — enough to be cut by a rowCap of 3. */
function seedCohort(): void {
  const db = ensureDb();
  for (let i = 0; i < 5; i += 1) {
    const { entry } = createPipelineEntry({
      candidateId: `cap-probe-${i}`,
      candidateLabel: `Cap Probe ${i}`,
      jobId: "cap-probe-job",
      jobTitle: "Cap Probe Role",
      stage: "Applied",
    });
    const id = entry.id;
    const createdAt = new Date(Date.now() - (i + 1) * DAY).toISOString();
    db.prepare(`UPDATE pipeline_entries SET created_at = ?, stage_changed_at = ? WHERE id = ?`).run(createdAt, createdAt, id);
  }
}

test("the cohort read is capped by default and the cap is a stated constant", () => {
  assert.equal(typeof ANALYTICS_COHORT_CAP, "number");
  assert.ok(ANALYTICS_COHORT_CAP > 0, "a cap of 0 or less would read nothing");
});

test("an uncut cohort answers truncated:false; a cut one says so", () => {
  seedCohort();
  const whole = pipelineAnalytics(30);
  assert.equal(whole.truncated, false, "a cohort under the cap is a complete answer");
  assert.ok(whole.total >= 5, "the seeded probes are in the window");

  const cut = pipelineAnalytics(30, { rowCap: 3 });
  assert.equal(cut.truncated, true, "the read hit its bound — say so rather than present a slice as the whole");
  assert.equal(cut.total, 3, "and the figures are computed over exactly the rows it read");
});

test("the prior-window slice carries the same bound and the same flag", () => {
  seedCohort();
  const endMs = Date.now();
  assert.equal(pipelineAnalyticsPrior(30, endMs).truncated, false);
  const cut = pipelineAnalyticsPrior(30, endMs, undefined, { rowCap: 2 });
  assert.equal(cut.truncated, true);
  assert.equal(cut.total, 2);
});
