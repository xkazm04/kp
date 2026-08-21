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

/** Is this a one-time SCHEMA block (create / rebuild / index)? The pre-tier rebuild
 *  legitimately copies EVERY row (`… SELECT … FROM decision_config`) — a migration that
 *  filtered by tenant would migrate one team's rows and strand the rest. Exempt, and
 *  named as such rather than silently passing on an unrelated `workspace_id` mention. */
function isSchemaBlock(sql: string): boolean {
  return /\b(create\s+(table|unique\s+index|index)|alter\s+table|drop\s+table)\b/i.test(sql);
}

/**
 * Is this query scoped by TENANT — i.e. does `workspace_id` constrain WHICH ROWS it
 * touches?
 *
 * The distinction this function exists for: a mere mention of `workspace_id` anywhere in
 * the statement proves nothing. `SELECT config_json, workspace_id FROM decision_config
 * WHERE phase = ?` names the column in the SELECT LIST and reads every team's row — the
 * exact hollow-guard shape a sibling sweep found nine times elsewhere in this codebase.
 * Scoping means the column appears in a PREDICATE (a WHERE clause), or — for an INSERT —
 * in the COLUMN LIST, which is what decides the tier a new row lands in.
 */
export function isTenantScoped(sql: string): boolean {
  const insert = /\binsert\s+into\s+decision_config\s*\(([^)]*)\)/i.exec(sql);
  if (insert) return /\bworkspace_id\b/i.test(insert[1]);
  const whereIdx = sql.search(/\bwhere\b/i);
  if (whereIdx === -1) return false;
  return /\bworkspace_id\b/i.test(sql.slice(whereIdx));
}

test("every decision_config query is workspace-scoped (dual-tier: org-default OR team-override)", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update|delete\s+from)\s+decision_config\b/i.test(s));
  assert.ok(touching.length >= 4, `expected >=4 decision_config queries, found ${touching.length}`);
  let checked = 0;
  for (const sql of touching) {
    if (isSchemaBlock(sql)) continue;
    checked += 1;
    assert.ok(
      isTenantScoped(sql),
      `a decision_config query does not CONSTRAIN workspace_id (a mention in the select list is not scoping):\n${sql.trim().slice(0, 220)}`
    );
  }
  // Non-vacuity: the schema-block exemption must not swallow the whole set.
  assert.ok(checked >= 4, `only ${checked} non-schema decision_config queries were checked — the scan has stopped matching`);
});

// The guard's own guard. Before this, the assertion was `/workspace_id/.test(sql)`, which
// passes on a statement that merely NAMES the column while reading every tenant's rows.
test("the scoping check rejects a query that only MENTIONS workspace_id", () => {
  // Hollow: named in the select list, absent from the predicate → reads every team's row.
  assert.equal(isTenantScoped(`SELECT config_json, workspace_id FROM decision_config WHERE phase = ?`), false);
  // Hollow: no predicate at all.
  assert.equal(isTenantScoped(`SELECT workspace_id, config_json FROM decision_config`), false);
  // Hollow: an INSERT that omits the tier column — the row lands on NULL (the ORG
  // baseline) and silently becomes every team's policy.
  assert.equal(isTenantScoped(`INSERT INTO decision_config (phase, config_json, updated_at) VALUES (?, ?, ?)`), false);
  // Hollow: a delete that clears the phase for EVERY tier.
  assert.equal(isTenantScoped(`DELETE FROM decision_config WHERE phase = ?`), false);

  // Genuinely scoped, in each shape the store actually uses.
  assert.equal(isTenantScoped(`SELECT config_json FROM decision_config WHERE phase = ? AND workspace_id = ?`), true);
  assert.equal(isTenantScoped(`SELECT config_json FROM decision_config WHERE phase = ? AND workspace_id IS NULL`), true);
  assert.equal(
    isTenantScoped(
      `SELECT config_json FROM decision_config WHERE phase = ? AND (workspace_id = ? OR workspace_id IS NULL) ORDER BY (workspace_id IS NULL) ASC LIMIT 1`
    ),
    true
  );
  assert.equal(isTenantScoped(`INSERT INTO decision_config (phase, config_json, updated_at, workspace_id) VALUES (?, ?, ?, ?)`), true);
  assert.equal(isTenantScoped(`DELETE FROM decision_config WHERE phase = ? AND workspace_id IS NULL`), true);
});
