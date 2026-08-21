import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (P2) — source guard for the profiles domain (same shape as
// analyses-tenancy.test.ts). Asserts every SQL statement touching the `profiles`
// table is workspace-scoped, so a future unscoped query fails CI instead of
// leaking candidate profiles across tenants.
//
// SCOPED MEANS A BOUND PREDICATE, NOT A MENTION. This guard used to accept any
// statement whose text merely CONTAINED "workspace_id" — so
// `SELECT id, label, workspace_id FROM profiles ORDER BY created_at DESC LIMIT ?`
// (every tenant's candidate profiles, with the owning workspace helpfully selected)
// passed it. That is the same hollow shape found in the pipeline guards: what isolates
// a tenant is a bound `workspace_id = ?` in the WHERE/JOIN, while a SELECT-list
// `workspace_id` is what a leak actually looks like. INSERT is the one exception —
// there the column list IS the stamp, and the value rides in the VALUES tuple.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "profiles.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

/** A bound tenant predicate: `WHERE workspace_id = ?` / `AND p.workspace_id = ?`. */
const BOUND_SCOPE = /\bworkspace_id\s*=\s*\?/i;
/** An INSERT stamps the tenant by naming the column in its column list. */
const STAMPS_SCOPE = /\bworkspace_id\b/i;

function isInsert(sql: string): boolean {
  return /\binsert\s+(or\s+\w+\s+)?into\s+profiles\b/i.test(sql);
}

test("every SELECT/UPDATE/DELETE/INSERT on the profiles table carries workspace_id", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update|delete\s+from)\s+profiles\b/i.test(s));
  assert.ok(touching.length >= 7, `expected >=7 profiles queries, found ${touching.length}`);
  for (const sql of touching) {
    const required = isInsert(sql) ? STAMPS_SCOPE : BOUND_SCOPE;
    assert.ok(
      required.test(sql),
      `a profiles query is NOT workspace-scoped (a bound workspace_id = ? predicate is required; a SELECT-list mention is not scoping):\n${sql.trim().slice(0, 200)}`
    );
  }
});

// Non-vacuity: pin that the matcher itself rejects the leak shape it is meant to catch.
// Without this, a future "simplification" back to a bare /workspace_id/ presence test
// would leave the guard above green while it no longer guards anything.
test("the guard rejects a workspace_id that is merely SELECTED, never filtered", () => {
  const leak = `SELECT id, label, archetype, workspace_id
       FROM profiles ORDER BY created_at DESC LIMIT ?`;
  assert.equal(isInsert(leak), false, "the leak shape is a read, so it must face the predicate check");
  assert.equal(BOUND_SCOPE.test(leak), false, "a SELECT-list workspace_id must NOT count as tenant scoping");
  assert.equal(BOUND_SCOPE.test(`${leak.replace("LIMIT ?", "")} WHERE workspace_id = ?`), true, "a bound predicate does");
});
