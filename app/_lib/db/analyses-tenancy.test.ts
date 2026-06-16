import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (P2) — source guard (kp convention: a source-level regex test, since
// the store needs SQLite and isn't unit-loadable). Reads analyses.ts and asserts
// EVERY SQL statement touching the `analyses` table is workspace-scoped, so a future
// query that forgets `workspace_id` fails CI instead of silently leaking across tenants.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "analyses.ts"), "utf8");

// Each backtick-delimited block is a prepared-statement SQL string.
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every SELECT/UPDATE/INSERT on the analyses table carries workspace_id", () => {
  const touchingAnalyses = sqlBlocks.filter((s) => /\b(from|into|update)\s+analyses\b/i.test(s));
  // Sanity: we actually found the queries (guard against a regex that matches nothing).
  assert.ok(touchingAnalyses.length >= 6, `expected >=6 analyses queries, found ${touchingAnalyses.length}`);
  for (const sql of touchingAnalyses) {
    assert.ok(
      /workspace_id/.test(sql),
      `an analyses query is NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`
    );
  }
});

test("the gemini_cache queries are NOT falsely flagged (they aren't tenant data)", () => {
  // gemini_cache lives in analyses.ts but is a shared prompt cache, not per-tenant —
  // confirm the guard's table matcher doesn't sweep it in.
  const cacheBlocks = sqlBlocks.filter((s) => /\bfrom\s+gemini_cache\b/i.test(s));
  assert.ok(cacheBlocks.length >= 1);
  assert.ok(cacheBlocks.every((s) => !/\bfrom\s+analyses\b/i.test(s)));
});
