import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (P2) — source guard for the profiles domain (same shape as
// analyses-tenancy.test.ts). Asserts every SQL statement touching the `profiles`
// table is workspace-scoped, so a future unscoped query fails CI instead of
// leaking candidate profiles across tenants.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "profiles.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every SELECT/UPDATE/DELETE/INSERT on the profiles table carries workspace_id", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update|delete\s+from)\s+profiles\b/i.test(s));
  assert.ok(touching.length >= 7, `expected >=7 profiles queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `a profiles query is NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`);
  }
});
