import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (P1) — source guard for the Library JD tables (same shape as
// analyses-tenancy.test.ts). Asserts every SQL statement touching `jds` /
// `jd_revisions` is workspace-scoped, so a future unscoped query fails CI instead
// of leaking a team's private drafts/openings across tenants.
//
// EXEMPTION: the four analysis-status task writers (setJdAnalysisTask,
// finishJdAnalysis, failJdAnalysis, markJdAnalyzing) are deliberately keyed by slug
// alone. They run from the detached jd_build task, which owns exactly one globally-
// unique slug (a JD's PK) — a by-slug flip can only ever touch that JD's single row
// and cannot cross tenants. They're the ONLY jds queries allowed without workspace_id.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "jobs.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

// An UPDATE that sets only analysis_* columns keyed by slug = a status-writer.
function isStatusWriter(sql: string): boolean {
  return /update\s+jds\s+set/i.test(sql) && /analysis_(status|task_id|error|json)/i.test(sql) && !/workspace_id/i.test(sql);
}

test("every jds / jd_revisions query is workspace-scoped, except the by-slug status writers", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+(jds|jd_revisions)\b/i.test(s));
  assert.ok(touching.length >= 10, `expected >=10 JD-table queries, found ${touching.length}`);

  const exempt = touching.filter(isStatusWriter);
  assert.equal(exempt.length, 4, `expected exactly 4 by-slug status-writer queries, found ${exempt.length}`);

  for (const sql of touching.filter((s) => !isStatusWriter(s))) {
    assert.ok(/workspace_id/.test(sql), `a JD-table query is NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`);
  }
});

test("the jobs corpus queries are NOT falsely swept in (shared cross-company reference)", () => {
  // The `jobs` table is the shared corpus (listCorpusJobs) — a later, separate Phase 1
  // slice. Confirm the JD-table matcher above doesn't require workspace_id on plain
  // `jobs` reads (which are intentionally not scoped yet).
  const jobsOnly = sqlBlocks.filter((s) => /\bfrom\s+jobs\b/i.test(s) && !/\bfrom\s+(jds|jd_revisions)\b/i.test(s));
  assert.ok(jobsOnly.length >= 1, "expected some plain jobs-table queries");
});
