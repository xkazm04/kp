import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope - source guard for the gig_lessons table (same shape as
// jobseeker-sources-tenancy.test.ts). Every SQL statement touching the table, in ANY of
// the gig stores, must bind workspace_id, so a future unscoped query fails CI instead of
// leaking one workspace's rows into another's. NO by-id carve-out and NO
// `tenancy:global` block: point reads bind the workspace too (tenancy.ts).
//
// SCOPED MEANS A BOUND PREDICATE, NOT A MENTION: a bound `workspace_id = ?` in the WHERE
// isolates a tenant, a SELECT-list `workspace_id` is what a leak looks like. INSERT is
// the one exception - there the column list IS the stamp.
const TABLE = "gig_lessons";
const MIN_STATEMENTS = 4;
const STORES = ["gigs.ts", "gigs-sources.ts", "gigs-specialists.ts", "gigs-attempts.ts", "gigs-outcomes.ts"];

const dir = path.dirname(fileURLToPath(import.meta.url));
const sources = STORES.map((f) => ({ file: f, src: readFileSync(path.join(dir, f), "utf8") }));
const sqlBlocks = sources.flatMap(({ src }) => [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]));

const BOUND_SCOPE = /\bworkspace_id\s*=\s*\?/i;
const STAMPS_SCOPE = /\bworkspace_id\b/i;
const touches = new RegExp(`\\b(from|into|update|join|delete\\s+from)\\s+${TABLE}\\b`, "i");
const inserts = new RegExp(`\\binsert\\s+(or\\s+\\w+\\s+)?into\\s+${TABLE}\\b`, "i");

test(`every statement on ${TABLE} binds workspace_id (no carve-out)`, () => {
  const touching = sqlBlocks.filter((s) => touches.test(s));
  assert.ok(touching.length >= MIN_STATEMENTS, `expected >=${MIN_STATEMENTS} ${TABLE} statements, found ${touching.length}`);
  for (const sql of touching) {
    assert.doesNotMatch(sql, /tenancy:global/i, `${TABLE} has no cross-workspace query:\n${sql.trim().slice(0, 200)}`);
    const required = inserts.test(sql) ? STAMPS_SCOPE : BOUND_SCOPE;
    assert.ok(required.test(sql), `a ${TABLE} statement is NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`);
  }
});

test("no gig store export defaults its tenant (the route-layer hole)", () => {
  for (const { file, src } of sources) {
    assert.doesNotMatch(src, /workspaceId\s*:\s*string\s*=/, `${file} defaults workspaceId - it must be a required argument`);
  }
});

// Non-vacuity: the matcher itself rejects the leak shape it is meant to catch.
test("the guard rejects a workspace_id that is merely SELECTED, never filtered", () => {
  const leak = `SELECT id, workspace_id FROM ${TABLE} ORDER BY created_at DESC LIMIT ?`;
  assert.ok(touches.test(leak), "the leak shape must be recognized as touching the table");
  assert.equal(inserts.test(leak), false);
  assert.equal(BOUND_SCOPE.test(leak), false, "a SELECT-list workspace_id must NOT count as tenant scoping");
  assert.equal(BOUND_SCOPE.test(leak.replace("ORDER BY", "WHERE workspace_id = ? ORDER BY")), true);
});
