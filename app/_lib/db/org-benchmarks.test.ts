import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "./core.ts";
import { createPipelineEntry } from "./pipeline.ts";
import { orgHiringBenchmark, teamHiringStats, BENCHMARK_MIN_TEAMS } from "./org-benchmarks.ts";

after(() => cleanupUnitDb());

function makeTeam(orgId: string, wsId: string): void {
  ensureDb()
    .prepare(`INSERT OR IGNORE INTO workspaces (id, name, org_id, type, created_at) VALUES (?, ?, ?, 'team', '2026-01-01T00:00:00.000Z')`)
    .run(wsId, wsId, orgId);
}
function addEntries(wsId: string, stages: string[]): void {
  stages.forEach((stage, i) =>
    createPipelineEntry({ candidateId: `${wsId}-c${i}`, candidateLabel: `C${i}`, jobId: "j", jobTitle: "R", stage, workspaceId: wsId })
  );
}
// 10 entries: 4 reach Interview+ (2 Interview + 2 Hired), 2 Hired.
const TEN = ["Accepted", "Accepted", "Accepted", "Accepted", "Screened", "Screened", "Interview", "Interview", "Hired", "Hired"];

test("the org benchmark aggregates ACROSS sibling teams (org_id-join) once past the k-anon floor", () => {
  makeTeam("org-multi", "org-multi-a");
  makeTeam("org-multi", "org-multi-b");
  addEntries("org-multi-a", TEN);
  addEntries("org-multi-b", TEN);

  const org = orgHiringBenchmark("org-multi");
  assert.equal(org.available, true, "20 entries across 2 teams clears the floor");
  assert.equal(org.contributingTeams, 2);
  assert.equal(org.totalEntries, 20, "aggregates BOTH teams' entries");
  assert.equal(org.interviewRatePct, 40); // 8 of 20 reached Interview+
  assert.equal(org.hireRatePct, 20); // 4 of 20 Hired

  // teamHiringStats is workspace-scoped — one team's stats never include the other's.
  assert.equal(teamHiringStats("org-multi-a").totalEntries, 10, "a team sees only its own pipeline");
});

test("below the k-anonymity floor the rates are WITHHELD (only the team count is reported)", () => {
  makeTeam("org-solo", "org-solo-a");
  addEntries("org-solo-a", TEN); // 1 team, 10 entries — both under the floor

  const org = orgHiringBenchmark("org-solo");
  assert.equal(org.available, false, "one team can't read a benchmark — it would be a window onto itself");
  assert.ok(org.contributingTeams < BENCHMARK_MIN_TEAMS);
  assert.equal(org.interviewRatePct, 0, "rates withheld below the floor");
  assert.equal(org.hireRatePct, 0);
  assert.equal(org.medianTimeToHireDays, null);
});

test("the benchmark is AGGREGATE-ONLY — it returns no raw row, candidate, or team identity", () => {
  makeTeam("org-shape", "org-shape-a");
  makeTeam("org-shape", "org-shape-b");
  addEntries("org-shape-a", TEN);
  addEntries("org-shape-b", TEN);

  const org = orgHiringBenchmark("org-shape");
  // The ONLY keys are aggregates — no candidateId/label/workspace_id/rows leak out.
  assert.deepEqual(
    Object.keys(org).sort(),
    ["available", "contributingTeams", "hireRatePct", "interviewRatePct", "medianTimeToHireDays", "totalEntries"]
  );
});
