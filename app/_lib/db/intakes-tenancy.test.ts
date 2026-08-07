import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope — source guard for role_intakes (role-intake dialogs, Phase 1).
// The surface is operator-internal with NO public token, so the rule is
// stricter than the token-keyed tables: EVERY query touching role_intakes —
// point reads included — must filter or stamp workspace_id. A leaked intake id
// must never resolve across tenants.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "intakes.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const TOUCHES = /\b(from|into|update)\s+role_intakes\b/i;

test("role_intakes: every query is workspace-scoped (no exemptions)", () => {
  const touching = sqlBlocks.filter((s) => TOUCHES.test(s));
  assert.ok(touching.length >= 6, `expected >=6 role_intakes queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `a role_intakes query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
