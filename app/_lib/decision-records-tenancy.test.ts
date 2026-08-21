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

/** Does this statement scope to a tenant WHERE IT COUNTS?
 *
 *  A bare `/workspace_id/` search over the statement is not that test: the sibling
 *  db-pipeline guards were found accepting `workspace_id` in a SELECT LIST as proof of
 *  scoping, which it is not — `SELECT content_hash, key_id, workspace_id FROM
 *  decision_records ORDER BY seq DESC LIMIT 1` mentions the column and still reads
 *  ANOTHER TEAM's chain head. For a read/write the column must appear in a PREDICATE
 *  (after WHERE/AND/ON); for an INSERT it must appear in the column list, which is
 *  where an insert states its tenant. */
export function scopesToWorkspace(sql: string): boolean {
  if (/\binsert\s+into\s+decision_records\b/i.test(sql)) return /workspace_id/i.test(sql);
  const predicate = sql.replace(/\s+/g, " ").match(/\bwhere\b(.*)$/i)?.[1] ?? "";
  return /\b(where|and)\s+\(*\s*(decision_records\.)?workspace_id\s*(=|in\b|is\b)/i.test(` where ${predicate}`);
}

test("every decision_records DML query is workspace-scoped (per-tenant chain)", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+decision_records\b/i.test(s));
  assert.ok(touching.length >= 4, `expected >=4 decision_records queries (seal head + insert, list, verify), found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(
      scopesToWorkspace(sql),
      `a decision_records query is NOT workspace-scoped IN A PREDICATE — it would splice chains across tenants:\n${sql.trim().slice(0, 220)}`
    );
  }
});

// Non-vacuity: the predicate rule must actually reject the shapes a bare
// /workspace_id/ substring search waves through. If these ever pass, the guard above
// has quietly become a spell-check for a column name.
test("the guard rejects a workspace_id that is only SELECTED, ordered by, or inserted-elsewhere", () => {
  assert.equal(
    scopesToWorkspace("SELECT content_hash, key_id, workspace_id FROM decision_records ORDER BY seq DESC LIMIT 1"),
    false,
    "a workspace_id in the SELECT LIST scopes nothing — it reads every tenant's rows"
  );
  assert.equal(
    scopesToWorkspace("SELECT * FROM decision_records WHERE candidate_ref = ? ORDER BY workspace_id, seq DESC"),
    false,
    "ordering by workspace_id is not filtering by it"
  );
  assert.equal(scopesToWorkspace("SELECT * FROM decision_records WHERE candidate_ref = ?"), false);
  // …and still accepts the real, correctly-scoped shapes.
  assert.equal(scopesToWorkspace("SELECT * FROM decision_records WHERE candidate_ref = ? AND workspace_id = ? ORDER BY seq DESC LIMIT ?"), true);
  assert.equal(scopesToWorkspace("SELECT * FROM decision_records WHERE workspace_id = ? ORDER BY seq ASC"), true);
  assert.equal(scopesToWorkspace("INSERT INTO decision_records (prev_hash, workspace_id, key_id) VALUES (?, ?, ?)"), true);
});
