// Tenant scope — proof for job_workspace_state, the per-team lifecycle overlay on a
// SHARED corpus role (status, target hires, posting languages; see the CREATE in
// core.ts and the store halves in jobs.ts + ../job-ingest.ts).
//
// The rule is the strict one, with an EMPTY exemption list: every statement that
// touches the table BINDS workspace_id — a predicate, a JOIN condition or an INSERT
// column, never merely a mention. There is deliberately no by-job-id carve-out: the
// job is shared by every tenant, so a job-only read would show one team another's
// close, and a job-only write would let the next team overwrite it (the same reasoning
// role_pattern_priorities, interview_kits and job_translations carry).
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TENANCY_SCOPED_TABLES } from "../tenancy.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const TABLE = "job_workspace_state";
const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.join(dir, p), "utf8").replace(/\r\n/g, "\n");
const SOURCES = { "jobs.ts": read("jobs.ts"), "../job-ingest.ts": read("../job-ingest.ts") };

/** A statement may be exempt from binding workspace_id only by being named here, with
 *  its reason. EMPTY on purpose, and asserted empty below. */
const EXEMPT: ReadonlyArray<string> = [];

/** Mirrors tenancy-coverage.test.ts's bindsWorkspace: BOUND, not mentioned. */
function bindsWorkspace(sql: string): boolean {
  if (/workspace_id\s*(=|IN\b|IS\b)/i.test(sql)) return true;
  return /INSERT\s+INTO\s+[a-z_]+\s*\([^)]*\bworkspace_id\b[^)]*\)/i.test(sql);
}

const statements = Object.entries(SOURCES).flatMap(([file, src]) =>
  [...src.matchAll(/`([^`]*)`/g)]
    .map((m) => m[1])
    .filter((s) => new RegExp(`\\b(from|into|update|join)\\s+${TABLE}\\b`, "i").test(s))
    .map((sql) => ({ file, sql }))
);

test("job_workspace_state is declared workspace-scoped in the tenancy manifest", () => {
  assert.ok(TENANCY_SCOPED_TABLES.has(TABLE));
});

test("every job_workspace_state statement binds workspace_id (exemption list empty)", () => {
  assert.deepEqual(EXEMPT, [], "the overlay has no by-id carve-out");
  // The writes (status upsert, the close CAS, the config upsert) and the reads (the
  // point reads + every enumeration fold) — both files must carry some.
  assert.ok(statements.length >= 8, `expected the overlay's reads and writes, found ${statements.length}`);
  for (const file of Object.keys(SOURCES)) {
    assert.ok(statements.some((s) => s.file === file), `${file} is expected to touch the overlay`);
  }
  for (const { file, sql } of statements) {
    assert.ok(bindsWorkspace(sql), `${file}: a ${TABLE} statement does not BIND workspace_id:\n${sql.trim().slice(0, 240)}`);
  }
});

test("the overlay's key is (workspace_id, job_id), so two teams can each hold a state for one role", () => {
  const cols = ensureDb().prepare(`PRAGMA table_info(${TABLE})`).all() as { name: string; pk: number; notnull: number }[];
  const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  assert.deepEqual(pk, ["workspace_id", "job_id"]);
  assert.equal(cols.find((c) => c.name === "workspace_id")?.notnull, 1, "workspace_id is NOT NULL: there is no shared tier here");
  // Billing stays on the shared row: the overlay must never carry a go-live stamp.
  assert.equal(cols.some((c) => c.name === "published_at"), false, "published_at stays on jobs, out of the overlay");
});
