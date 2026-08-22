import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (P2) — source guard (kp convention: a source-level regex test, since
// the store needs SQLite and isn't unit-loadable). Reads analyses.ts and asserts
// EVERY SQL statement touching the `analyses` table is workspace-scoped, so a future
// query that forgets `workspace_id` fails CI instead of silently leaking across tenants.
//
// SCOPED MEANS A BOUND PREDICATE, NOT A MENTION. This guard used to accept any
// statement whose text merely CONTAINED "workspace_id", so the classic leak shape —
// a by-id point read that carries no tenant of its own but helpfully SELECTS the
// owning workspace:
//   `SELECT slug, candidate_label, payload_json, workspace_id FROM analyses WHERE slug = ?`
// — passed it while handing any caller another tenant's saved CV analysis by slug.
// What isolates a tenant is a bound `workspace_id = ?` in the WHERE/JOIN; a
// SELECT-list `workspace_id` is what a leak actually looks like. INSERT is the one
// exception — there the column list IS the stamp, and the value rides in the VALUES
// tuple. Same shape as profiles-tenancy.test.ts, which already made this correction.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "analyses.ts"), "utf8");

// Each backtick-delimited block is a prepared-statement SQL string.
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

/** A bound tenant predicate: `WHERE workspace_id = ?` / `AND a.workspace_id = ?`. */
const BOUND_SCOPE = /\bworkspace_id\s*=\s*\?/i;
/** An INSERT stamps the tenant by naming the column in its column list. */
const STAMPS_SCOPE = /\bworkspace_id\b/i;

function isInsert(sql: string): boolean {
  return /\binsert\s+(or\s+\w+\s+)?into\s+analyses\b/i.test(sql);
}

test("every SELECT/UPDATE/INSERT on the analyses table carries workspace_id", () => {
  const touchingAnalyses = sqlBlocks.filter((s) => /\b(from|into|update)\s+analyses\b/i.test(s));
  // Sanity: we actually found the queries (guard against a regex that matches nothing).
  assert.ok(touchingAnalyses.length >= 6, `expected >=6 analyses queries, found ${touchingAnalyses.length}`);
  for (const sql of touchingAnalyses) {
    const required = isInsert(sql) ? STAMPS_SCOPE : BOUND_SCOPE;
    assert.ok(
      required.test(sql),
      `an analyses query is NOT workspace-scoped (a bound workspace_id = ? predicate is required; a SELECT-list mention is not scoping):\n${sql.trim().slice(0, 200)}`
    );
  }
});

// Non-vacuity: pin that the matcher itself rejects the leak shape it exists to catch.
// Without this, a future "simplification" back to a bare /workspace_id/ presence test
// would leave the guard above green while it no longer guards anything.
test("the guard rejects a workspace_id that is merely SELECTED, never filtered", () => {
  const leak = `SELECT slug, candidate_label, jd_slug, score, payload_json, workspace_id
       FROM analyses WHERE slug = ?`;
  assert.equal(isInsert(leak), false, "the leak shape is a read, so it must face the predicate check");
  assert.equal(BOUND_SCOPE.test(leak), false, "a SELECT-list workspace_id must NOT count as tenant scoping");
  assert.equal(
    BOUND_SCOPE.test(`${leak} AND workspace_id = ?`),
    true,
    "a bound predicate does"
  );
  // The INSERT exemption must stay narrow: it applies to INSERTs only.
  assert.equal(
    isInsert(`INSERT INTO analyses (slug, payload_json, workspace_id) VALUES (?, ?, ?)`),
    true,
    "an INSERT stamps the tenant through its column list"
  );
});

test("the gemini_cache queries are NOT falsely flagged (they aren't tenant data)", () => {
  // gemini_cache lives in analyses.ts but is a shared prompt cache, not per-tenant —
  // confirm the guard's table matcher doesn't sweep it in.
  const cacheBlocks = sqlBlocks.filter((s) => /\bfrom\s+gemini_cache\b/i.test(s));
  assert.ok(cacheBlocks.length >= 1);
  assert.ok(cacheBlocks.every((s) => !/\bfrom\s+analyses\b/i.test(s)));
});
