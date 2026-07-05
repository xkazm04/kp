import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope (E0 Phase 1) — source guard for offers (offer letters). Every access is
// by the candidate's unguessable token or the globally-unique entry_id, plus two GLOBAL
// heartbeat sweeps (lapse-expired / due-reminders) — none can cross tenants. The one
// write that must stamp workspace_id is createOffer's INSERT (derived from the entry);
// a future recruiter enumeration would filter on it.
const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "offers-store.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+offers\b/i.test(s));

test("createOffer stamps workspace_id; offers reads are by-token/entry_id or a global sweep", () => {
  const inserts = touching.filter((s) => /insert\s+into\s+offers\b/i.test(s));
  assert.ok(inserts.length >= 1, `expected the createOffer INSERT, found ${inserts.length}`);
  for (const sql of inserts) {
    assert.ok(/workspace_id/.test(sql), `createOffer INSERT must stamp workspace_id:\n${sql.trim().slice(0, 220)}`);
  }
  const reads = touching.filter((s) => !/insert\s+into\s+offers\b/i.test(s));
  for (const sql of reads) {
    const ok =
      /workspace_id/.test(sql) || // scoped
      /\b(token|entry_id)\s*=\s*\?/i.test(sql) || // by-token / by-entry point op
      /\b(expires_at|reminded_at)\b/i.test(sql); // global lapse/reminder heartbeat sweep
    assert.ok(ok, `an offers read/update is neither scoped nor a by-key/sweep exemption:\n${sql.trim().slice(0, 220)}`);
  }
});
