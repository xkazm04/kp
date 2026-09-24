import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope — source guard for role_runs / role_run_stages (ADR-0011's ledger).
// The surface is operator-internal with NO public token, so the rule is the stricter
// one the role_intakes guard uses: EVERY query touching either table — point reads
// included — must filter or stamp workspace_id. A leaked run id must never resolve
// across tenants, and a stage artifact is the evidence behind a person-affecting
// decision, which makes a cross-tenant read of one worse than a leak of a draft.

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "role-runs.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const TOUCHES = /\b(from|into|update|delete\s+from)\s+(role_runs|role_run_stages)\b/i;

test("role_runs / role_run_stages: every query is workspace-scoped (no exemptions)", () => {
  const touching = sqlBlocks.filter((s) => TOUCHES.test(s) && !/CREATE\s+(TABLE|INDEX|UNIQUE)/i.test(s));
  assert.ok(touching.length >= 10, `expected >=10 ledger queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `a ledger query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});

test("the ledger is append-only: no UPDATE or DELETE against role_run_stages", () => {
  // The artifacts are the record of what the run did at a moment. A run whose history
  // can be edited cannot be the evidence behind a sealed decision — correcting a stage
  // means APPENDING a newer artifact and letting seq order them. The run ROW is a
  // cursor over the artifacts and may be updated; the artifacts may not.
  const mutating = sqlBlocks.filter((s) => /\b(update|delete\s+from)\s+role_run_stages\b/i.test(s));
  assert.deepEqual(mutating, [], `role_run_stages must never be updated or deleted:\n${mutating.join("\n")}`);
});
