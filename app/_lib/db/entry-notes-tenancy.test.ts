import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TENANCY_SCOPED_TABLES } from "../tenancy.ts";

// Tenant scope — source guard for `pipeline_entry_notes` (the per-entry note thread,
// db/entry-notes.ts), the same shape as intake-events-tenancy.test.ts. The BEHAVIOURAL
// proof (another workspace can neither list nor append) is entry-notes.test.ts; this file
// pins the SQL so a later statement cannot quietly drop the tenant.
//
// NO EXEMPTIONS: the rows are recruiter prose about a candidate, there is no public token
// and no candidate-facing read, so there is no capability link to carve a by-id exemption
// for. The one erasure DELETE lives in db/pipeline.ts (anonymizeEntry), keyed by the
// entry id the caller already proved belongs to its workspace — it is scanned separately
// below so it stays the ONLY statement allowed to omit workspace_id.
const here = path.dirname(fileURLToPath(import.meta.url));

function sqlBlocks(file: string): string[] {
  const src = readFileSync(path.join(here, file), "utf8");
  return [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
}

const TOUCHES = /\b(from|into|update|delete\s+from)\s+pipeline_entry_notes\b/i;

test("pipeline_entry_notes is classified workspace-scoped in the tenancy manifest", () => {
  assert.ok(TENANCY_SCOPED_TABLES.has("pipeline_entry_notes"));
});

test("every pipeline_entry_notes statement in the store is workspace-scoped", () => {
  const touching = sqlBlocks("entry-notes.ts").filter((s) => TOUCHES.test(s));
  // Non-vacuity: the insert, the list and the read-back.
  assert.ok(touching.length >= 3, `expected >=3 pipeline_entry_notes statements, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `an unscoped pipeline_entry_notes statement:\n${sql.trim().slice(0, 260)}`);
  }
});

test("the INSERT derives workspace_id from the entry, never from a bound parameter", () => {
  const insert = sqlBlocks("entry-notes.ts").find((s) => /insert\s+into\s+pipeline_entry_notes/i.test(s));
  assert.ok(insert, "the insert is found");
  const sql = insert.replace(/\s+/g, " ");
  assert.match(sql, /SELECT \?, e\.id, e\.workspace_id,/, "the tenant column is e.workspace_id of the entry row");
  assert.match(sql, /WHERE e\.id = \? AND e\.workspace_id = \?/, "and the entry must be in the caller's workspace");
});

test("the store has no UPDATE and no DELETE — the thread is append-only", () => {
  for (const sql of sqlBlocks("entry-notes.ts")) {
    assert.doesNotMatch(sql, /\b(update\s+pipeline_entry_notes|delete\s+from\s+pipeline_entry_notes)\b/i);
  }
});

test("the only DELETE anywhere is the erasure scrub in anonymizeEntry's region", () => {
  const deletes = sqlBlocks("pipeline.ts").filter((s) => /delete\s+from\s+pipeline_entry_notes/i.test(s));
  assert.equal(deletes.length, 1);
  assert.match(deletes[0].replace(/\s+/g, " ").trim(), /^DELETE FROM pipeline_entry_notes WHERE entry_id = \?$/);
});
