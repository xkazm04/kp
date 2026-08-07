import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for group_evals (same shape as
// campaign-tenancy.test.ts). Every DML statement touching the table must filter/stamp
// workspace_id so a team's comparative group evaluations can't leak across tenants.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "group-eval.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every group_evals DML query is workspace-scoped", () => {
  // Only INSERT/SELECT/UPDATE (not the CREATE/ALTER DDL that defines the column).
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+group_evals\b/i.test(s));
  assert.ok(touching.length >= 3, `expected >=3 group_evals DML queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `a group_evals query is NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`);
  }
});
