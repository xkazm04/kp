import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for decision_records (the tamper-evident
// decision hash chain; org plan §6, the hard structural item). The chain is PER-TENANT:
// EVERY DML query is workspace-scoped — the seal reads its own workspace's head hash,
// the INSERT stamps workspace_id, list filters it, and verify walks a single workspace's
// records — so one team's sealed rows never enter another's proof. There are no by-id
// exemptions here: an unscoped read would splice two teams' chains together.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "decision-record-store.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every decision_records DML query is workspace-scoped (per-tenant chain)", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+decision_records\b/i.test(s));
  assert.ok(touching.length >= 4, `expected >=4 decision_records queries (seal head + insert, list, verify), found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `a decision_records query is NOT workspace-scoped — it would splice chains across tenants:\n${sql.trim().slice(0, 220)}`);
  }
});
