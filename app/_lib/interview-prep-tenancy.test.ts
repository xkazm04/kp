import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for interview_preps (one timed interview
// plan per pipeline entry). Every op is keyed by the globally-unique entry_id, so a
// by-entry_id flip can't cross tenants; the write stamps workspace_id (derived from the
// entry) so a future enumeration is already scopable. The only query that must carry
// workspace_id is therefore the INSERT; the by-entry_id reads/updates are exempt.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "interview-prep.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const IP = /\b(from|into|update)\s+interview_preps\b/i;
const BY_ENTRY = /\bentry_id\s*(=\s*\?|in\s*\()/i; // by-entry_id point/list op (globally-unique key)

test("interview_preps writes stamp workspace_id; by-entry_id ops exempt", () => {
  const touching = sqlBlocks.filter((s) => IP.test(s));
  assert.ok(touching.length >= 4, `expected >=4 interview_preps queries, found ${touching.length}`);
  const mustScope = touching.filter((s) => !BY_ENTRY.test(s)); // the INSERT (not keyed by entry_id = ?)
  assert.ok(mustScope.length >= 1, `expected the INSERT to require scoping, found ${mustScope.length}`);
  for (const sql of mustScope) {
    assert.ok(/workspace_id/.test(sql), `an interview_preps write is NOT workspace-stamped:\n${sql.trim().slice(0, 220)}`);
  }
});
