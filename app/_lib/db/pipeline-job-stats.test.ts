// listJobPipelineStats — the per-job rollup behind the JD library's Pipeline and
// Hired columns (the surviving half of the Analytics "scoreboard" prototype).
//
// Worth its own coverage because the seeded dev database cannot exercise it: its
// saved JDs are e2e leftovers while its pipeline sits on directly-ingested corpus
// jobs, so every row legitimately reads "no linked job" there. Without this test
// the query would ship having never returned a non-empty result.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts must stay the first
// project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { createPipelineEntry, listJobPipelineStats, setPipelineEntryStage } from "./pipeline.ts";

after(() => cleanupUnitDb());

let seq = 0;
function entryAt(jobId: string, stage: string) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `stats-c${seq}`,
    candidateLabel: `Stats Candidate ${seq}`,
    jobId,
    jobTitle: `Role for ${jobId}`,
  });
  // createPipelineEntry lands at the first stage; move it to the target.
  if (stage !== "Accepted") setPipelineEntryStage(entry.id, stage);
  return entry;
}

test("rolls up per job: total, reached-interview and hired", () => {
  entryAt("jd-alpha", "Accepted");
  entryAt("jd-alpha", "Screened");
  entryAt("jd-alpha", "Interview");
  entryAt("jd-alpha", "Hired");
  entryAt("jd-beta", "Accepted");

  const stats = listJobPipelineStats();

  // "Reached interview" is stage >= Interview, so Interview AND Hired count —
  // the same threshold analytics' byJob uses (hasAdvancedPastScreening). If these
  // two ever disagree, the JD library and Analytics report different numbers for
  // the same role, which is worse than either being wrong alone.
  assert.deepEqual(stats["jd-alpha"], { total: 4, reachedInterview: 2, hired: 1 });
  assert.deepEqual(stats["jd-beta"], { total: 1, reachedInterview: 0, hired: 0 });
});

test("a job with no entries is ABSENT, not a zero row", () => {
  const stats = listJobPipelineStats();
  // The route turns a missing key into `pipeline: null`, which the column renders
  // as "no linked job" rather than "0 in pipeline". Returning a zeroed row here
  // would collapse those two different facts into one.
  assert.equal(stats["jd-never-used"], undefined);
});

test("stats are scoped to the caller's workspace", () => {
  entryAt("jd-tenant-check", "Accepted");
  // A different tenant must not see it. The rollup feeds a recruiter-facing
  // column, so a cross-tenant leak here would show one team another team's
  // hiring volume.
  const other = listJobPipelineStats("some-other-workspace");
  assert.equal(other["jd-tenant-check"], undefined);
  // ...and the owning workspace still does.
  assert.ok(listJobPipelineStats()["jd-tenant-check"]);
});
