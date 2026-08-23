import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope — source guard for `repo_scans` (App master P2, db/repo-scans.ts),
// the same shape as agents-tenancy.test.ts / campaign-tenancy.test.ts: every SQL
// statement touching the table must filter or stamp workspace_id, so a future
// unscoped query fails CI instead of leaking one team's scan across tenants.
//
// NO EXEMPTIONS — and that is the interesting part. Most stores here carve out
// by-id point reads on the "a globally-unique PK cannot cross tenants" argument.
// That argument does not hold for this table: the row a scan id resolves carries a
// filesystem path on the operator's own machine and a full machine read of a
// private codebase (contexts, hot spots, gate commands). An unscoped by-id read
// would turn the id into a bearer token for another team's source tree — exactly
// the class of carve-out the tenancy manifest warns about. If a future change adds
// one, it has to add it HERE, deliberately, with the reason.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "repo-scans.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

/** Statements this guard deliberately exempts. Empty, by the reasoning above. */
const EXEMPT_SQL: readonly RegExp[] = [];

test("every repo_scans query is workspace-scoped (no exemptions)", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update|delete\s+from)\s+repo_scans\b/i.test(s));
  assert.ok(touching.length >= 6, `expected >=6 repo_scans queries, found ${touching.length}`);
  for (const sql of touching) {
    if (EXEMPT_SQL.some((rx) => rx.test(sql.replace(/\s+/g, " ")))) continue;
    assert.ok(
      /workspace_id/.test(sql),
      `a repo_scans query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`
    );
  }
});

test("the INSERT stamps the tenant rather than defaulting it", () => {
  const insert = sqlBlocks.find((s) => /insert\s+into\s+repo_scans/i.test(s));
  assert.ok(insert, "expected the createRepoScan INSERT");
  assert.match(insert!, /workspace_id/, "the insert must name workspace_id explicitly");
});

test("every UPDATE carries a workspace_id predicate, not just the id", () => {
  const updates = sqlBlocks.filter((s) => /update\s+repo_scans/i.test(s));
  assert.ok(updates.length >= 3, `expected the running/complete/fail updates, found ${updates.length}`);
  for (const sql of updates) {
    assert.match(
      sql.replace(/\s+/g, " "),
      /where id = \? and workspace_id = \?/i,
      `an UPDATE is keyed by id alone — a leaked scan id must not be writable across tenants:\n${sql.trim().slice(0, 220)}`
    );
  }
});
