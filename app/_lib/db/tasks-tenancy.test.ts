import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for the background-task queue (tasks). Split
// by design: the RECRUITER-facing reads (the /api/tasks poll + history pager), the dedup
// lookup, and create are workspace-scoped so a user sees only their team's runs. The
// RUNNER ops are keyed by the globally-unique task id, and the GLOBAL boot-recovery /
// readiness probes are tagged `-- tenancy:global` — the one runner drains every team's
// queue and boot must recover all orphans, so those are legitimately cross-tenant.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "tasks.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const T = /\b(from|into|update)\s+tasks\b/i;
const EXEMPT = /\bid\s*=\s*\?|tenancy:global/i; // by-id runner op, or a tagged global system query

test("tasks: UI reads + dedup + create are workspace-scoped (by-id runner + global system exempt)", () => {
  const touching = sqlBlocks.filter((s) => T.test(s));
  assert.ok(touching.length >= 6, `expected >=6 tasks queries, found ${touching.length}`);
  const mustScope = touching.filter((s) => !EXEMPT.test(s));
  assert.ok(mustScope.length >= 4, `expected create + dedup + recent + history reads, found ${mustScope.length}`);
  for (const sql of mustScope) {
    assert.ok(/workspace_id/.test(sql), `a tasks query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
