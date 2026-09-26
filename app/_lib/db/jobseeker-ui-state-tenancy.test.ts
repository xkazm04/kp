// IMPORT ORDER IS LOAD-BEARING: unit-db must precede any module that reaches db-path.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getCoverNote, getCvDesignState, setCoverNote, setCvDesignState } from "./jobseeker-ui-state.ts";

after(() => cleanupUnitDb());

// Tenant scope — source guard for the jobseeker_ui_state table (the jobseeker-profiles-
// tenancy.test.ts shape): every statement binds workspace_id, NO carve-out. The profile
// id is the second key, and the route takes it from the session's own profile.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "jobseeker-ui-state.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const BOUND_SCOPE = /\bworkspace_id\s*=\s*\?/i;
const STAMPS_SCOPE = /\bworkspace_id\b/i;
const BOUND_PROFILE = /\bprofile_id\s*=\s*\?/i;

function isInsert(sql: string): boolean {
  return /\binsert\s+(or\s+\w+\s+)?into\s+jobseeker_ui_state\b/i.test(sql);
}

test("every SELECT/UPDATE/DELETE/INSERT on the jobseeker_ui_state table carries workspace_id and the profile", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update|delete\s+from)\s+jobseeker_ui_state\b/i.test(s));
  assert.ok(touching.length >= 5, `expected >=5 jobseeker_ui_state queries, found ${touching.length}`);
  for (const sql of touching) {
    if (isInsert(sql)) {
      assert.ok(STAMPS_SCOPE.test(sql) && /\bprofile_id\b/.test(sql), `an INSERT does not stamp the tenant and profile:\n${sql.trim().slice(0, 200)}`);
      continue;
    }
    assert.ok(BOUND_SCOPE.test(sql), `a jobseeker_ui_state query is NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`);
    assert.ok(BOUND_PROFILE.test(sql), `a jobseeker_ui_state query is not bound to one profile:\n${sql.trim().slice(0, 200)}`);
  }
});

test("the guard rejects a workspace_id that is merely SELECTED, never filtered", () => {
  const leak = `SELECT workspace_id, value_json FROM jobseeker_ui_state ORDER BY updated_at DESC`;
  assert.equal(BOUND_SCOPE.test(leak), false);
});

test("the same profile id in another workspace reads nothing", () => {
  setCvDesignState("jsp-1", { template: "editorial" }, "ws-a");
  setCoverNote("jsp-1", "post-1", "Dear team", "ws-a");
  assert.equal(getCvDesignState("jsp-1", "ws-b"), null);
  assert.equal(getCoverNote("jsp-1", "post-1", "ws-b"), null);
  assert.equal(getCoverNote("jsp-1", "post-1", "ws-a")?.value, "Dear team");
});
