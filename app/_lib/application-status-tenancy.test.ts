import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for application_status_links (the public
// token → pipeline-entry map a candidate uses to check their own status). Both reads are
// keyed by the unguessable token or the globally-unique entry_id (can't cross tenants);
// the mint stamps workspace_id (derived from the entry).
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "application-status-store.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+application_status_links\b/i.test(s));

test("the status-link mint stamps workspace_id; reads are by token/entry_id", () => {
  const inserts = touching.filter((s) => /insert\s+into\s+application_status_links\b/i.test(s));
  assert.ok(inserts.length >= 1, `expected the mint INSERT, found ${inserts.length}`);
  for (const sql of inserts) {
    assert.ok(/workspace_id/.test(sql), `the status-link mint must stamp workspace_id:\n${sql.trim().slice(0, 220)}`);
  }
  const reads = touching.filter((s) => !/insert\s+into\s+application_status_links\b/i.test(s));
  for (const sql of reads) {
    const ok = /workspace_id/.test(sql) || /\b(token|entry_id)\s*=\s*\?/i.test(sql);
    assert.ok(ok, `an application_status_links read is neither scoped nor by token/entry_id:\n${sql.trim().slice(0, 220)}`);
  }
});
