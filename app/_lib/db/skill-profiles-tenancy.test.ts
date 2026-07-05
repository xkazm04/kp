import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for skill_profiles (durable, candidate-owned
// skill credentials). The public trust lookups are by the unguessable token (a candidate
// presents their credential to anyone) and the mint's idempotent read is by the globally-
// unique submission_id — neither can cross tenants. The issue INSERT stamps workspace_id
// (derived from the submission).
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "skill-profiles.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+skill_profiles\b/i.test(s));

test("issueSkillProfile stamps workspace_id; skill_profiles reads are by token/submission_id", () => {
  const inserts = touching.filter((s) => /insert\s+into\s+skill_profiles\b/i.test(s));
  assert.ok(inserts.length >= 1, `expected the issue INSERT, found ${inserts.length}`);
  for (const sql of inserts) {
    assert.ok(/workspace_id/.test(sql), `issueSkillProfile INSERT must stamp workspace_id:\n${sql.trim().slice(0, 220)}`);
  }
  const reads = touching.filter((s) => !/insert\s+into\s+skill_profiles\b/i.test(s));
  for (const sql of reads) {
    const ok = /workspace_id/.test(sql) || /\b(token|submission_id)\s*=\s*\?/i.test(sql);
    assert.ok(ok, `a skill_profiles read is neither scoped nor by token/submission_id:\n${sql.trim().slice(0, 220)}`);
  }
});
