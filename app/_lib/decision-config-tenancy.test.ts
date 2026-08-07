import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (P2 — the dual-tier hiring policy) — decision_config is DUAL-TIER: org-default
// rows (workspace_id NULL — the company baseline: screening rules + compliance jurisdiction) +
// team-override rows (workspace_id = team). Every read/write filters workspace_id (the cascade
// read, the tiered delete-then-insert). No by-id exemptions — an unscoped read would leak or
// clobber another tier.
const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, "decision-config-store.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every decision_config query is workspace-scoped (dual-tier: org-default OR team-override)", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update|delete\s+from)\s+decision_config\b/i.test(s));
  assert.ok(touching.length >= 4, `expected >=4 decision_config queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `a decision_config query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
