import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (P1) — source guard for the pipeline_entries table, spanning EVERY
// file that queries it: the pipeline store, analytics, the profiles helpers, the
// sim reset, and the offers-store status writer. The candidate pipeline is the
// app's highest-PII table; a forgotten workspace_id here is the top cross-tenant risk.
//
// EXEMPTION: the two candidate-facing TOKEN reads (findEntryByLeadToken /
// findEntryByErasureToken) resolve an entry by its CSPRNG capability token — the
// token IS the authorization (same doctrine as offer/schedule tokens), so a
// workspace filter is redundant. Every OTHER pipeline_entries query must carry it.
const dir = path.dirname(fileURLToPath(import.meta.url));
const files = [
  path.join(dir, "pipeline.ts"),
  path.join(dir, "analytics.ts"),
  path.join(dir, "profiles.ts"),
  path.join(dir, "..", "sim-store.ts"),
  path.join(dir, "..", "offers-store.ts"),
];
const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

// Exempt: a candidate capability-token read (WHERE lead_token/erasure_token = ?), a
// query tagged `-- tenancy:global` — the ONE automation engine's global sweep and the
// GDPR consent sweep, which must span teams and scope each per-entry WRITE by that
// entry's own workspace_id instead — or the TENANT-DERIVATION point read, whose whole
// job is to discover an entry's workspace from its globally-unique PK (a token-driven
// flow with no session workspace has nothing to scope BY until it has run).
function isExempt(sql: string): boolean {
  return (
    /where\s+(lead_token|erasure_token)\s*=/i.test(sql) ||
    /tenancy:global/i.test(sql) ||
    /^\s*select\s+workspace_id\s+from\s+pipeline_entries\s+where\s+id\s*=\s*\?\s*$/i.test(sql.trim())
  );
}

/** Does workspace_id actually CONSTRAIN this statement?
 *
 *  A bare `/workspace_id/` match — what this guard used to accept — is satisfied by
 *  the SELECT LIST, so `SELECT id, workspace_id FROM pipeline_entries WHERE job_id = ?`
 *  passed while reading every tenant's rows. That is not a hypothetical shape: it is
 *  the shape of the two global sweeps in this file, i.e. exactly what a new query
 *  gets copied from. Require the column in a PREDICATE (`workspace_id = ?` /
 *  `IN (…)`, any table alias prefix); an INSERT has no WHERE, so there the test is
 *  that the tenant is among the columns being written. */
function isScoped(sql: string): boolean {
  if (/^\s*insert\s+into/i.test(sql.trim())) return /\bworkspace_id\b/.test(sql);
  return /\bworkspace_id\s*(=|in)\s*[?(@:]/i.test(sql);
}

test("the scoping predicate rejects a tenant-blind query that merely mentions the column", () => {
  // Pins the guard's own teeth: without this the assertion below could pass on
  // every query in the repo while catching nothing.
  assert.equal(isScoped("SELECT id, workspace_id FROM pipeline_entries WHERE job_id = ?"), false);
  assert.equal(isScoped("SELECT id FROM pipeline_entries WHERE job_id = ? AND workspace_id = ?"), true);
  assert.equal(isScoped("SELECT e.id FROM pipeline_entries e WHERE e.workspace_id = ?"), true);
  assert.equal(isScoped("INSERT INTO pipeline_entries (id, workspace_id) VALUES (@id, @workspace_id)"), true);
  assert.equal(isScoped("INSERT INTO pipeline_entries (id, stage) VALUES (@id, @stage)"), false);
});

test("every pipeline_entries query across all stores is workspace-scoped (token reads + global sweep exempt)", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update|delete\s+from)\s+pipeline_entries\b/i.test(s));
  assert.ok(touching.length >= 30, `expected >=30 pipeline_entries queries, found ${touching.length}`);
  assert.ok(touching.some(isExempt), "expected the token-read / global-sweep exemptions to match something");

  for (const sql of touching.filter((s) => !isExempt(s))) {
    assert.ok(isScoped(sql), `a pipeline_entries query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
