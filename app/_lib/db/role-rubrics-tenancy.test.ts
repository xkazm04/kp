import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope — source guard for role_rubrics and the slate read, the same
// rule role_intakes carries and for the same reason: both surfaces are
// operator-internal with NO public token, so EVERY query touching them — point
// reads included — must filter or stamp workspace_id. A leaked job id must not
// resolve another team's rubric or slate.
//
// A source guard rather than only a behavioral one because the behavioral test
// can only catch the queries that exist today; this one fails the moment a NEW
// unscoped query is added, which is when the defect is cheapest to fix.
const here = path.dirname(fileURLToPath(import.meta.url));
const sqlBlocksIn = (file: string) =>
  [...readFileSync(path.join(here, file), "utf8").matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const TOUCHES_RUBRICS = /\b(from|into|update)\s+role_rubrics\b/i;
const TOUCHES_ENTRIES = /\b(from|into|update)\s+pipeline_entries\b/i;

test("role_rubrics: every query is workspace-scoped (no exemptions)", () => {
  const touching = sqlBlocksIn("role-rubrics.ts").filter((s) => TOUCHES_RUBRICS.test(s));
  assert.ok(touching.length >= 4, `expected >=4 role_rubrics queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `a role_rubrics query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});

test("role-slate: every pipeline_entries query is workspace-scoped", () => {
  const touching = sqlBlocksIn("role-slate.ts").filter((s) => TOUCHES_ENTRIES.test(s));
  assert.ok(touching.length >= 2, `expected >=2 pipeline_entries queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `a slate query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
