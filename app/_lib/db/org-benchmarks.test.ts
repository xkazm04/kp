import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "./core.ts";
import { createPipelineEntry } from "./pipeline.ts";
import { orgHiringBenchmark, teamHiringStats, teamBenchmark, BENCHMARK_MIN_TEAMS } from "./org-benchmarks.ts";

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

test("the benchmark a team sees EXCLUDES its own workspace — a 2-team org can't back out the lone peer (bug-ui-scan-2026-07-09 #3)", () => {
  makeTeam("org-pair", "org-pair-a"); // the caller
  makeTeam("org-pair", "org-pair-b"); // the single peer
  addEntries("org-pair-a", TEN);
  addEntries("org-pair-b", TEN);

  // The raw org-wide aggregate (self INCLUDED) clears the floor and — paired with the
  // caller's OWN known stats — would expose the single peer. This is the vulnerability.
  assert.equal(orgHiringBenchmark("org-pair").available, true, "a self-included aggregate would leak the lone peer");

  // What the route serves now: self excluded ⇒ only 1 OTHER team ⇒ withheld.
  const { org, team } = teamBenchmark("org-pair-a");
  assert.equal(org.available, false, "a lone peer's rates must stay withheld");
  assert.equal(org.contributingTeams, 1, "the caller's own team is NOT counted toward the org aggregate");
  assert.equal(org.interviewRatePct, 0, "rates withheld below the floor");
  // The peer's pipeline SIZE is a team figure too once one team is the only
  // contributor — and the whole payload crosses the wire, not just what the locked
  // panel draws. Leaving it in handed the caller "team B has exactly 10 candidates".
  assert.equal(org.totalEntries, 0, "a lone contributor's volume is withheld with its rates");
  assert.equal(team.totalEntries, 10, "the team's OWN stats are still returned alongside");
});

test("a below-floor aggregate that ≥2 teams DO stand behind still reports its size", () => {
  // Both peers are tiny, so the ENTRY floor withholds the rates — but two teams
  // contributed, so the volume is a real aggregate and stays legible.
  makeTeam("org-small", "org-small-a"); // the caller
  makeTeam("org-small", "org-small-b");
  makeTeam("org-small", "org-small-c");
  addEntries("org-small-a", TEN);
  addEntries("org-small-b", ["Accepted", "Screened"]);
  addEntries("org-small-c", ["Accepted", "Interview"]);

  const { org } = teamBenchmark("org-small-a");
  assert.equal(org.available, false, "4 peer entries is under BENCHMARK_MIN_ENTRIES");
  assert.equal(org.contributingTeams, 2);
  assert.equal(org.totalEntries, 4, "two contributors make the volume an aggregate, not a team's figure");
  assert.equal(org.interviewRatePct, 0, "the rates stay withheld — the sample is noise");
});

test("with ≥2 OTHER teams the peer benchmark is available and never counts the caller (bug-ui-scan-2026-07-09 #3)", () => {
  makeTeam("org-trio", "org-trio-a"); // the caller
  makeTeam("org-trio", "org-trio-b");
  makeTeam("org-trio", "org-trio-c");
  addEntries("org-trio-a", TEN);
  addEntries("org-trio-b", TEN);
  addEntries("org-trio-c", TEN);

  const { org } = teamBenchmark("org-trio-a");
  assert.equal(org.available, true, "2 peer teams (20 entries) clear the k-anon floor");
  assert.equal(org.contributingTeams, 2, "only the 2 OTHER teams contribute — the caller is excluded");
  assert.equal(org.totalEntries, 20, "aggregates the 2 peers, not the caller's own 10");
});

test("the benchmark is AGGREGATE-ONLY — it returns no raw row, candidate, or team identity", () => {
  makeTeam("org-shape", "org-shape-a");
  makeTeam("org-shape", "org-shape-b");
  addEntries("org-shape-a", TEN);
  addEntries("org-shape-b", TEN);

  const org = orgHiringBenchmark("org-shape");
  // The ONLY keys are aggregates — no candidateId/label/workspace_id/rows leak out.
  // `truncated` joined them when the read gained BENCHMARK_ROW_CAP: it is a boolean
  // about THIS read, not a figure about any team, so it cannot de-anonymize anyone.
  assert.deepEqual(
    Object.keys(org).sort(),
    ["available", "contributingTeams", "hireRatePct", "interviewRatePct", "medianTimeToHireDays", "totalEntries", "truncated"]
  );
});
