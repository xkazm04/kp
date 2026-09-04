// The analytics window queries must SEEK, not scan.
//
// Every windowed query in `pipelineAnalytics` (app/_lib/db/analytics.ts) is one
// shape: `WHERE created_at >= ? AND (job_title IS NULL OR job_title NOT LIKE ?)
// AND workspace_id = ?` over pipeline_entries (the cohort rows) or pipeline_events
// (KO discards, momentum, the kind counts, the hold-resolution probe). Before the
// composite indexes, the two tables carried a workspace-only index and a
// `created_at DESC` index — and SQLite uses at most ONE index per table in a plan,
// so the planner had to pick between seeking by tenant and then date-filtering
// every row that tenant ever wrote, or seeking by date across every tenant. On the
// Insights tab that is the whole page: nine such queries per request, twice
// (current window + prior window for the deltas).
//
// EXPLAIN QUERY PLAN is the only honest assertion here — a timing test on a
// throwaway DB with a few dozen rows proves nothing, and asserting the index
// EXISTS proves only that a CREATE ran, not that the planner reaches for it.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

/** The planner's own account of how it will run `sql`, as one string. Binds a
 *  placeholder string per `?` — EXPLAIN QUERY PLAN still needs every parameter
 *  bound, and the values do not affect which index the planner picks here (no
 *  ANALYZE stats on a throwaway DB, so the choice is structural). */
function plan(sql: string): string {
  const params = new Array((sql.match(/\?/g) ?? []).length).fill("x");
  return (ensureDb().prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[])
    .map((r) => r.detail)
    .join(" | ");
}

// The exact predicate `pipelineAnalytics` issues, notSim() included — a plan for a
// simplified query would not be evidence about the query the route actually runs.
const NOT_SIM = "(job_title IS NULL OR job_title NOT LIKE ?)";

test("the windowed entry cohort query seeks the (workspace_id, created_at) index", () => {
  const detail = plan(
    `SELECT job_id, stage, status, created_at FROM pipeline_entries
      WHERE created_at >= ? AND ${NOT_SIM} AND workspace_id = ?`
  );
  assert.match(detail, /idx_pipeline_entries_ws_created/, `planner chose: ${detail}`);
  // SEARCH, not SCAN: the composite has to be a seek on both columns, which is the
  // whole point. A plan that merely "USING INDEX" for a covering scan would still
  // read every row of the table.
  assert.match(detail, /SEARCH/, `planner chose: ${detail}`);
  assert.doesNotMatch(detail, /SCAN pipeline_entries(?! USING)/, `planner chose: ${detail}`);
});

test("the bounded (current + prior window) entry query seeks the same index", () => {
  // The prior-window read adds an upper bound; the composite must still serve it as
  // one range seek rather than degrading to a tenant scan.
  const detail = plan(
    `SELECT job_id, stage FROM pipeline_entries
      WHERE created_at >= ? AND created_at < ? AND ${NOT_SIM} AND workspace_id = ?`
  );
  assert.match(detail, /idx_pipeline_entries_ws_created/, `planner chose: ${detail}`);
  assert.match(detail, /SEARCH/, `planner chose: ${detail}`);
});

test("the windowed event queries seek the (workspace_id, created_at) index", () => {
  for (const sql of [
    // KO discards, grouped by role.
    `SELECT job_title, COUNT(*) AS n FROM pipeline_events
      WHERE kind='ko_declined' AND created_at >= ? AND ${NOT_SIM} AND workspace_id = ? GROUP BY job_title`,
    // The automation-impact kind counts.
    `SELECT kind, COUNT(*) AS c FROM pipeline_events
      WHERE created_at >= ? AND ${NOT_SIM} AND workspace_id = ? GROUP BY kind`,
    // The momentum buckets.
    `SELECT kind, to_stage, created_at FROM pipeline_events
      WHERE created_at >= ? AND kind IN ('advanced', 'rejected') AND ${NOT_SIM} AND workspace_id = ?`,
  ]) {
    const detail = plan(sql);
    assert.match(detail, /idx_pipeline_events_ws_created/, `planner chose: ${detail}\nfor: ${sql}`);
    assert.match(detail, /SEARCH/, `planner chose: ${detail}\nfor: ${sql}`);
  }
});

test("the indexes are workspace-first, so the tenant equality is the seek prefix", () => {
  // A range column ahead of an equality column ends the usable prefix at the range,
  // which would leave the tenant filter to a post-scan. Read the recorded order back
  // rather than trusting the CREATE statement's text.
  const db = ensureDb();
  for (const [index, table] of [
    ["idx_pipeline_entries_ws_created", "pipeline_entries"],
    ["idx_pipeline_events_ws_created", "pipeline_events"],
  ]) {
    const cols = (db.prepare(`PRAGMA index_info(${index})`).all() as { name: string }[]).map((r) => r.name);
    assert.deepEqual(cols, ["workspace_id", "created_at"], `${index} on ${table} is not workspace-first`);
  }
});
