import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TENANCY_SCOPED_TABLES } from "../tenancy.ts";

// Tenant scope — source guard for `match_run_results` (db/match-runs.ts), the same shape
// as entry-notes-tenancy.test.ts. The BEHAVIOURAL proof (another workspace's run id reads
// back as nothing) is match-runs.test.ts and match-add-provenance.test.ts; this file pins
// the SQL so a later statement cannot quietly drop the tenant.
//
// The expiry DELETE on the write path is deliberately NOT tenant-bound — it removes rows of
// EVERY workspace whose clock has run out, a housekeeping sweep with no tenant to name —
// and is the one statement allowed to omit workspace_id. The erasure DELETE in
// db/pipeline.ts derives the workspace from the entry.
const here = path.dirname(fileURLToPath(import.meta.url));

function sqlBlocks(file: string): string[] {
  const src = readFileSync(path.join(here, file), "utf8");
  return [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
}

const TOUCHES = /\b(from|into|update|delete\s+from|replace\s+into)\s+match_run_results\b/i;

test("match_run_results is classified workspace-scoped in the tenancy manifest", () => {
  assert.ok(TENANCY_SCOPED_TABLES.has("match_run_results"));
});

test("every match_run_results statement in the store is workspace-scoped, except the expiry sweep", () => {
  const touching = sqlBlocks("match-runs.ts").filter((s) => TOUCHES.test(s));
  assert.ok(touching.length >= 3, `expected >=3 match_run_results statements, found ${touching.length}`);
  const unscoped = touching.filter((s) => !/workspace_id/.test(s));
  assert.equal(unscoped.length, 1, `only the expiry sweep may omit workspace_id:\n${unscoped.join("\n---\n")}`);
  assert.match(unscoped[0].replace(/\s+/g, " ").trim(), /^DELETE FROM match_run_results WHERE expires_at <= \?$/);
});

test("the read binds workspace, candidate, job and expiry together", () => {
  const read = sqlBlocks("match-runs.ts").find((s) => /select\s+facts_json/i.test(s));
  assert.ok(read, "the read is found");
  const sql = read.replace(/\s+/g, " ");
  for (const col of ["run_id = ?", "job_id = ?", "workspace_id = ?", "candidate_id = ?", "expires_at > ?"]) {
    assert.ok(sql.includes(col), `the read must bind ${col}`);
  }
});

test("the erasure DELETE is the only one outside the store, scoped to the entry's workspace", () => {
  const deletes = sqlBlocks("pipeline.ts").filter((s) => /delete\s+from\s+match_run_results/i.test(s));
  assert.equal(deletes.length, 1);
  assert.match(
    deletes[0].replace(/\s+/g, " ").trim(),
    /^DELETE FROM match_run_results WHERE candidate_id = \? AND workspace_id = \(SELECT workspace_id FROM pipeline_entries WHERE id = \?\)$/
  );
});
