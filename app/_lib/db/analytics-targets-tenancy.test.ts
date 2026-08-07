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

test("every SELECT/INSERT/DELETE on analytics_targets carries workspace_id", () => {
  const touching = sqlBlocks.filter((s) =>
    /\b(from|into|update|delete\s+from)\s+analytics_targets\b/i.test(s)
  );
  // Sanity: we actually found the queries (guard against a regex that matches nothing).
  assert.ok(touching.length >= 3, `expected >=3 analytics_targets queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(
      /workspace_id/.test(sql),
      `an analytics_targets query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`
    );
  }
});
