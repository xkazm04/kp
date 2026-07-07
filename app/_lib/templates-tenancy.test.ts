import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (P2 — the curated shared library) — jd_templates is a DUAL-tier table
// like the jobs corpus: org-shared rows (workspace_id NULL) are the curated company
// library every team reads; team-private rows carry the team's id. Every read/write
// filters on the shared-corpus predicate (workspace_id IS NULL OR workspace_id = ?) or
// an explicit workspace_id, so a team never sees or edits another team's private
// template, and the org-wide default lives only on org rows. No by-id exemptions — a
// bare id read would cross the private tier.
const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, "templates-store.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every jd_templates query is workspace-scoped (dual-tier: org-shared OR team-private)", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update|delete\s+from)\s+jd_templates\b/i.test(s));
  assert.ok(touching.length >= 8, `expected >=8 jd_templates queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `a jd_templates query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
