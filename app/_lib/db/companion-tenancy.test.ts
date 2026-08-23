import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope — source guard for the operator-companion tables (companion.ts).
// The surface is operator-internal with NO public token and no capability link,
// so the rule is the strict one, like role_intakes: EVERY query touching any
// companion_* table — point reads and the brain-index upsert included — must
// filter or stamp workspace_id. The exemption list is deliberately EMPTY.
//
// The brain index is the one worth stating out loud: its rows are pointers into
// the operator's private memory tree, so an unscoped by-node_id read would make
// a leaked episode id a bearer token for another team's conversations.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "companion.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const TABLES = ["companion_threads", "companion_turns", "companion_proposals", "companion_brain_index"] as const;
const TOUCHES = /\b(from|into|update|join)\s+companion_[a-z_]+\b/i;

/** workspace_id must be BOUND — a predicate or an INSERT column — never merely
 *  named in a SELECT list (the hollow-guard shape tenancy-coverage.test.ts
 *  keeps finding elsewhere). */
function bindsWorkspace(sql: string): boolean {
  if (/workspace_id\s*(=|IN\b|IS\b)/i.test(sql)) return true;
  return /INSERT\s+INTO\s+[a-z_]+\s*\([^)]*\bworkspace_id\b[^)]*\)/i.test(sql);
}

test("companion_*: every query is workspace-scoped (no exemptions)", () => {
  const touching = sqlBlocks.filter((s) => TOUCHES.test(s));
  assert.ok(touching.length >= 10, `expected >=10 companion_* queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(
      bindsWorkspace(sql),
      `a companion_* query does not BIND workspace_id (mentioning the column is not scoping it):\n${sql.trim().slice(0, 240)}`
    );
  }
});

test("companion_*: each of the four tables actually has its read+write paths scanned", () => {
  // Non-vacuity. A rename that made one table invisible to the regex would leave
  // the assertion above passing over a smaller inventory — the exact way this
  // family of guard reads green while checking nothing.
  for (const table of TABLES) {
    const touching = sqlBlocks.filter((s) => new RegExp(`\\b(from|into|update|join)\\s+${table}\\b`, "i").test(s));
    assert.ok(touching.length >= 2, `expected ${table}'s read+write paths, found ${touching.length}`);
  }
});
