import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (P1) — source guard for the jobs corpus, spanning BOTH files that
// touch the `jobs` / `job_ingests` tables (db/jobs.ts reads, ../job-ingest.ts the
// write path + lifecycle reads on its own connection).
//
// DUAL model: seeded corpus rows (workspace_id NULL) are the shared cross-company
// reference every team matches against; authored openings carry a team's id. So
// ENUMERATION reads must carry workspace_id (via `(workspace_id IS NULL OR = ?)` or
// a strict `= ?`), and the INSERT stamps it.
//
// EXEMPTION: by-id point ops (getJob, getJobsByIds, getJobStatus, setJobStatus, and
// insertJob's existence checks) are keyed on the globally-unique job id PK — a by-id
// read/flip returns/touches exactly that one row and can't enumerate another tenant.
const dir = path.dirname(fileURLToPath(import.meta.url));
const src = `${readFileSync(path.join(dir, "jobs.ts"), "utf8")}\n${readFileSync(path.join(dir, "..", "job-ingest.ts"), "utf8")}`;
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

// A read/write keyed by `WHERE id …` (or `UPDATE jobs … WHERE id`) is a by-id point op.
function isByIdPointOp(sql: string): boolean {
  return /(from|update)\s+jobs\b[\s\S]*?\bwhere\s+id\b/i.test(sql);
}

test("every jobs / job_ingests enumeration query is workspace-scoped (by-id point ops exempt)", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+(jobs|job_ingests)\b/i.test(s));
  assert.ok(touching.length >= 10, `expected >=10 jobs-table queries, found ${touching.length}`);

  // The exemption must actually match something (guard against a regex that matches nothing).
  assert.ok(touching.some(isByIdPointOp), "expected some exempt by-id point ops");

  for (const sql of touching.filter((s) => !isByIdPointOp(s))) {
    assert.ok(/workspace_id/.test(sql), `a jobs-table enumeration query is NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`);
  }
});
