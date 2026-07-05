import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for rediscovery_alerts (the standing
// silver-medalist feed). recordRediscoveryAlerts stamps workspace_id and
// listRediscoveryAlerts filters it, so one team's rejected-then-eligible candidates
// never surface in another team's feed. Dismiss is a by-id point op (exempt).
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "rediscovery-alert-store.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every rediscovery_alerts enumeration/insert query is workspace-scoped (by-id exempt)", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+rediscovery_alerts\b/i.test(s));
  assert.ok(touching.length >= 2, `expected >=2 rediscovery_alerts queries, found ${touching.length}`);
  const mustScope = touching.filter((s) => !/\bid\s*=\s*\?/i.test(s)); // dismiss is by id
  assert.ok(mustScope.length >= 2, `expected the record INSERT + list read, found ${mustScope.length}`);
  for (const sql of mustScope) {
    assert.ok(/workspace_id/.test(sql), `a rediscovery_alerts query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
