import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (P1) — source guard (kp convention: a source-level regex test, since
// the store needs SQLite and isn't unit-loadable). Reads analytics.ts and asserts
// EVERY SQL statement touching the `analytics_targets` table filters on workspace_id,
// so a future query that forgets it fails CI instead of silently leaking hiring goals
// (funnel targets, the time-to-hire goal, and the recruiter_hourly_czk ROI rate)
// across tenants. The PK was widened to (metric, workspace_id) — mirror of channel_spend.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "analytics.ts"), "utf8");

// Each backtick-delimited block is a prepared-statement SQL string.
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

// A BOUND tenant predicate — `workspace_id = ?` / `= @ws` / `= :ws` / `= $ws`.
//
// The check used to be a bare /workspace_id/ over the whole statement, which any
// MENTION satisfied: `SELECT metric, target_value, workspace_id FROM analytics_targets`
// — no WHERE clause at all, every tenant's funnel goals, time-to-hire goal and
// recruiter_hourly_czk rate in one result set — passed this guard, verified by
// injecting exactly that query and watching the test stay green. A guard a leak can
// satisfy by naming the column it forgot to filter on is not a guard.
const BOUND_TENANT_PREDICATE = /workspace_id\s*=\s*[?@:$]/i;

/** A read/write that must NAME the tenant in its predicate. */
const isInsert = (sql: string) => /\binsert\s+into\s+analytics_targets\b/i.test(sql);

test("every SELECT/INSERT/DELETE on analytics_targets carries workspace_id", () => {
  const touching = sqlBlocks.filter((s) =>
    /\b(from|into|update|delete\s+from)\s+analytics_targets\b/i.test(s)
  );
  // Sanity: we actually found the queries (guard against a regex that matches nothing).
  assert.ok(touching.length >= 3, `expected >=3 analytics_targets queries, found ${touching.length}`);
  for (const sql of touching) {
    const excerpt = sql.trim().slice(0, 220);
    if (isInsert(sql)) {
      // A write is scoped by the value it STORES, so the tenant must be an inserted
      // column — and part of the conflict target, or an upsert would resolve against
      // another team's row for the same metric name.
      assert.match(sql, /\([^)]*\bworkspace_id\b[^)]*\)\s*VALUES/i, `an analytics_targets INSERT does not store workspace_id:\n${excerpt}`);
      assert.match(sql, /on\s+conflict\s*\([^)]*\bworkspace_id\b[^)]*\)/i, `an analytics_targets upsert's conflict target is not tenant-scoped:\n${excerpt}`);
    } else {
      assert.match(sql, BOUND_TENANT_PREDICATE, `an analytics_targets query has no BOUND workspace_id predicate:\n${excerpt}`);
    }
  }
});

// The guard's own non-vacuity check: the shape that slipped past the old assertion must
// fail the new one, and the shapes that are genuinely scoped must still pass. Without
// this, a future loosening of BOUND_TENANT_PREDICATE re-opens the hole silently.
test("the predicate rejects a statement that merely MENTIONS workspace_id", () => {
  assert.doesNotMatch(
    `SELECT metric, target_value, workspace_id FROM analytics_targets`,
    BOUND_TENANT_PREDICATE,
    "selecting the column is not filtering on it"
  );
  assert.doesNotMatch(
    `DELETE FROM analytics_targets WHERE metric = ? -- workspace_id`,
    BOUND_TENANT_PREDICATE,
    "naming the column in a comment is not filtering on it"
  );
  assert.match(`SELECT metric FROM analytics_targets WHERE workspace_id = ?`, BOUND_TENANT_PREDICATE);
  assert.match(`DELETE FROM analytics_targets WHERE metric = @m AND workspace_id = @ws`, BOUND_TENANT_PREDICATE);
});
