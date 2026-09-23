// The cohort read (journeyCohort), against an ISOLATED throwaway DB
// (testing/unit-db.ts must stay the first project import).
//
// Pinned:
//   1. NO PAGE CAP. The board pages at 50; the cohort is the WHOLE workspace, because
//      a coverage figure computed over a page is a figure about the page.
//   2. NO CANDIDATE ON THE WIRE. The cohort carries kinds, times and actor class only.
//   3. OUTCOMES. A rejected entry reads `rejected` (a decision), an old silent one reads
//      `stalled` (a lapse the process owns).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { actOnPipelineEntry, createPipelineEntry } from "../db/pipeline.ts";
import { journeyCohort, JOURNEY_STALL_DAYS } from "./project.ts";

after(() => cleanupUnitDb());

const WS = "workspace";

function add(i: number, jobId: string) {
  return createPipelineEntry({
    candidateId: `coh-c${i}`,
    candidateLabel: `Cohort Candidate ${i}`,
    jobId,
    jobTitle: `Cohort Role ${jobId}`,
  }).entry;
}

test("the cohort reads the whole workspace, never a page", () => {
  for (let i = 0; i < 60; i++) add(i, i % 2 ? "coh-job-a" : "coh-job-b");
  const cohort = journeyCohort({ workspaceId: WS });
  const ours = cohort.instances.filter((x) => x.jobId.startsWith("coh-job-"));
  assert.equal(ours.length, 60, "all 60 journeys, past the board's page of 50");
  const roles = cohort.roles.filter((r) => r.jobId.startsWith("coh-job-"));
  assert.deepEqual(roles.map((r) => r.n).sort(), [30, 30]);
});

test("no candidate label travels", () => {
  const cohort = journeyCohort({ workspaceId: WS });
  assert.ok(!JSON.stringify(cohort).includes("Cohort Candidate"), "labels stay on the board");
});

test("a rejection is rejected; silence past the stall window is stalled", () => {
  const rejected = add(900, "coh-job-c");
  actOnPipelineEntry(rejected.id, "reject", "no fit");
  const quiet = add(901, "coh-job-c");
  const later = Date.now() + (JOURNEY_STALL_DAYS + 1) * 86_400_000;
  const cohort = journeyCohort({ workspaceId: WS, now: later });
  const byId = new Map(cohort.instances.map((x) => [x.id, x]));
  assert.equal(byId.get(rejected.id)?.outcome, "rejected");
  assert.equal(byId.get(quiet.id)?.outcome, "stalled");
  assert.ok((byId.get(quiet.id)?.steps.length ?? 0) > 0, "the creation event is on the path");
});
