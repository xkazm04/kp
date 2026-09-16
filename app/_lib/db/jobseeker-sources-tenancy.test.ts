import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope — source guard for the jobseeker_sources table (same shape as
// profiles-tenancy.test.ts). Asserts every SQL statement touching the table binds
// workspace_id, so a future unscoped query fails CI instead of leaking one workspace's
// job-seeker data into another's. This table has NO by-id carve-out: point reads bind
// the workspace too (tenancy.ts).
//
// SCOPED MEANS A BOUND PREDICATE, NOT A MENTION: what isolates a tenant is a bound
// `workspace_id = ?` in the WHERE, while a SELECT-list `workspace_id` is what a leak
// looks like. INSERT is the one exception — there the column list IS the stamp.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "jobseeker-sources.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

/** A bound tenant predicate: `WHERE workspace_id = ?` / `AND workspace_id = ?`. */
const BOUND_SCOPE = /\bworkspace_id\s*=\s*\?/i;
/** An INSERT stamps the tenant by naming the column in its column list. */
const STAMPS_SCOPE = /\bworkspace_id\b/i;

function isInsert(sql: string): boolean {
  return /\binsert\s+(or\s+\w+\s+)?into\s+jobseeker_sources\b/i.test(sql);
}

// The ONE exemption, and why it is one: `listWorkspacesWithEnabledSources` is the clock
// job's fan-out list (WP4c). The clock runs with no request and no tenant, so it must ask
// "which workspaces have a scan to run" before it can bind any of them — the same shape
// as the automation engine's `-- tenancy:global` sweep in pipeline.ts. It returns ids
// only (never a source row), and every read/write the per-workspace scan then makes binds
// `workspace_id = ?` again. A second tagged block here is a review question, not a pass.
const GLOBAL_TAG = /tenancy:global/i;

test("every SELECT/UPDATE/DELETE/INSERT on the jobseeker_sources table carries workspace_id", () => {
  const all = sqlBlocks.filter((s) => /\b(from|into|update|delete\s+from)\s+jobseeker_sources\b/i.test(s));
  const global = all.filter((s) => GLOBAL_TAG.test(s));
  assert.equal(global.length, 1, "exactly one tagged cross-workspace query is allowed: the clock fan-out list");
  assert.match(global[0], /SELECT DISTINCT s\.workspace_id/, "the global query hands back workspace ids, never source rows");
  const touching = all.filter((s) => !GLOBAL_TAG.test(s));
  assert.ok(touching.length >= 9, `expected >=9 jobseeker_sources queries, found ${touching.length}`);
  for (const sql of touching) {
    const required = isInsert(sql) ? STAMPS_SCOPE : BOUND_SCOPE;
    assert.ok(
      required.test(sql),
      `a jobseeker_sources query is NOT workspace-scoped (a bound workspace_id = ? predicate is required; a SELECT-list mention is not scoping):\n${sql.trim().slice(0, 200)}`
    );
  }
});

// Non-vacuity: pin that the matcher itself rejects the leak shape it is meant to catch,
// so a "simplification" back to a bare /workspace_id/ presence test cannot leave the
// guard above green while it guards nothing.
test("the guard rejects a workspace_id that is merely SELECTED, never filtered", () => {
  const leak = `SELECT id, workspace_id FROM jobseeker_sources ORDER BY created_at DESC LIMIT ?`;
  assert.equal(isInsert(leak), false, "the leak shape is a read, so it must face the predicate check");
  assert.equal(BOUND_SCOPE.test(leak), false, "a SELECT-list workspace_id must NOT count as tenant scoping");
  assert.equal(BOUND_SCOPE.test(`${leak.replace("ORDER BY", "WHERE workspace_id = ? ORDER BY")}`), true, "a bound predicate does");
});
