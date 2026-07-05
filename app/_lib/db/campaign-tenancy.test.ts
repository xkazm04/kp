import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for campaign_packs (same shape as
// jds-tenancy.test.ts). Every SQL statement touching the table must filter/stamp
// workspace_id, so a future unscoped query fails CI instead of leaking a team's
// generated campaign packs across tenants.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "campaign.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every campaign_packs query is workspace-scoped", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+campaign_packs\b/i.test(s));
  assert.ok(touching.length >= 2, `expected >=2 campaign_packs queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `a campaign_packs query is NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`);
  }
});
