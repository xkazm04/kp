import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for the dev-case surface (devcase.ts):
// dev_cases, dev_lifecycle, dev_postings, dev_submissions, dev_sessions,
// dev_session_events. The RECRUITER enumeration reads (listDevCases / listLifecycles /
// listPostings / listSubmissions) plus every INSERT must carry workspace_id so one team
// can neither see nor accrete into another team's cases/postings/submissions. Everything
// else is exempt because it can't cross tenants: a point/child op keyed by a
// globally-unique id/token/child-key, or a tenant-DERIVATION read (SELECT workspace_id
// FROM the parent) that stamps the child row from its parent's tenant.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "devcase.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

const DEV_TABLES = /\b(from|into|update)\s+(dev_cases|dev_lifecycle|dev_postings|dev_submissions|dev_sessions|dev_session_events)\b/i;
const KEY_OP = /\b(id|token|session_id|posting_id|case_id)\s*=\s*\?/i; // point/child op on a globally-unique key
const DERIVE = /select\s+[^`]*\bworkspace_id\b[^`]*\bfrom\b/i; // tenant-derivation read from a parent

test("every dev-case enumeration/insert query is workspace-scoped (by-id/token/derive ops exempt)", () => {
  const touching = sqlBlocks.filter((s) => DEV_TABLES.test(s));
  assert.ok(touching.length >= 12, `expected >=12 dev-case queries, found ${touching.length}`);
  const mustScope = touching.filter((s) => !KEY_OP.test(s) && !DERIVE.test(s));
  // The list* enumeration reads + the six INSERTs.
  assert.ok(mustScope.length >= 6, `expected the enumeration reads + INSERTs to require scoping, found ${mustScope.length}`);
  for (const sql of mustScope) {
    assert.ok(/workspace_id/.test(sql), `a dev-case query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
