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

// A read keyed on a candidate capability token (WHERE lead_token/erasure_token = ?).
function isTokenRead(sql: string): boolean {
  return /where\s+(lead_token|erasure_token)\s*=/i.test(sql);
}

test("every pipeline_entries query across all stores is workspace-scoped (token reads exempt)", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update|delete\s+from)\s+pipeline_entries\b/i.test(s));
  assert.ok(touching.length >= 30, `expected >=30 pipeline_entries queries, found ${touching.length}`);
  assert.ok(touching.some(isTokenRead), "expected the token-read exemptions to match something");

  for (const sql of touching.filter((s) => !isTokenRead(s))) {
    assert.ok(/workspace_id/.test(sql), `a pipeline_entries query is NOT workspace-scoped:\n${sql.trim().slice(0, 220)}`);
  }
});
