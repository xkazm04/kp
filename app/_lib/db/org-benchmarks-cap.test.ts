// The org benchmark reads are BOUNDED, and say when they hit the bound.
//
// `teamHiringStats` and `orgHiringBenchmark` selected every pipeline_entries row
// for a team / for a whole ORG (across sibling teams) with no LIMIT, and the org
// read is by construction the widest scan in the app. A benchmark computed over a
// silent slice is worse than a withheld one — it looks like the org's rate and is
// the rate of whatever subset SQLite happened to return — so the cap ships with a
// `truncated` flag on the payload.
//
// Isolated throwaway DB (testing/unit-db.ts must stay the first project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { BENCHMARK_ROW_CAP, orgHiringBenchmark, teamHiringStats } from "./org-benchmarks.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

function seedTeam(workspaceId: string, orgId: string, n: number): void {
  const db = ensureDb();
  const now = new Date().toISOString();
  db.prepare(`INSERT OR REPLACE INTO workspaces (id, name, org_id, created_at) VALUES (?, ?, ?, ?)`).run(
    workspaceId,
    workspaceId,
    orgId,
    now
  );
  for (let i = 0; i < n; i += 1) {
    db.prepare(
      `INSERT INTO pipeline_entries (id, candidate_label, job_title, stage, status, created_at, stage_changed_at, workspace_id)
       VALUES (?, ?, ?, 'Applied', 'active', ?, ?, ?)`
    ).run(`${workspaceId}-${i}`, `cap ${i}`, "Cap Bench Role", now, now, workspaceId);
  }
}

test("the benchmark row cap is a stated constant", () => {
  assert.equal(typeof BENCHMARK_ROW_CAP, "number");
  assert.ok(BENCHMARK_ROW_CAP > 0);
});

test("a team's own stats are capped and flagged", () => {
  seedTeam("cap-team-a", "cap-org", 5);
  assert.equal(teamHiringStats("cap-team-a").truncated, false, "5 rows under the cap is complete");
  const cut = teamHiringStats("cap-team-a", { rowCap: 2 });
  assert.equal(cut.truncated, true);
  assert.equal(cut.totalEntries, 2);
});

test("the org-wide aggregate is capped and flagged", () => {
  seedTeam("cap-team-b", "cap-org2", 4);
  seedTeam("cap-team-c", "cap-org2", 4);
  assert.equal(orgHiringBenchmark("cap-org2").truncated, false);
  const cut = orgHiringBenchmark("cap-org2", { rowCap: 3 });
  assert.equal(cut.truncated, true, "an org benchmark that read a slice must not present it as the org");
});
