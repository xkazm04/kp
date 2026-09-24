import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope — source guard for `intake_events` (the role-intake history,
// db/intake-events.ts), the same shape as intakes-tenancy.test.ts / repo-scans-tenancy.
//
// NO EXEMPTIONS, and for the same two reasons the table it describes has none:
//
//   1. the rows hold a hiring requestor's own words about a role — operator-internal
//      text with no public token and no candidate-facing read, so there is no capability
//      link to carve an exemption for;
//   2. the primary key is an AUTOINCREMENT INTEGER. Most stores here exempt by-id point
//      reads on the "a globally-unique PK cannot cross tenants" argument. That argument
//      is the opposite of true for a small ascending integer: `id = 41` names a
//      different team's row in every deployment, which is exactly the shape a by-id
//      carve-out must never be granted to.
//
// TWO FILES ARE SCANNED, not one. The runtime path lives in db/intake-events.ts, but the
// boot BACKFILL writes the same table from db/core.ts on the raw init handle (it runs
// inside ensureDb, before the connection is memoized, so it cannot call the store — the
// seedBenchmarkTeam exception). A guard that read only the store would have declared the
// table scoped while a second, unscoped INSERT sat in the initializer.
const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = ["intake-events.ts", "core.ts"] as const;

/** Template literals are how every store in this directory writes SQL. */
function sqlBlocks(file: string): string[] {
  const src = readFileSync(path.join(here, file), "utf8");
  return [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
}

const TOUCHES = /\b(from|into|update|delete\s+from)\s+intake_events\b/i;

/** Statements this guard deliberately exempts. Empty, by the reasoning above — and it
 *  stays a named, empty list so that adding one is a visible decision in a diff rather
 *  than a regex quietly loosened. */
const EXEMPT_SQL: readonly RegExp[] = [];

test("every intake_events statement is workspace-scoped (no exemptions)", () => {
  const touching = SOURCES.flatMap((file) =>
    sqlBlocks(file)
      .filter((s) => TOUCHES.test(s))
      .map((sql) => ({ file, sql }))
  );
  // Non-vacuity: the insert, the list, the count and the erase in the store, plus the
  // backfill's insert and its role_intakes read in core.ts. A refactor that renames the
  // table or drops the SQL must fail here rather than pass by finding nothing.
  assert.ok(touching.length >= 5, `expected >=5 intake_events statements, found ${touching.length}`);
  for (const { file, sql } of touching) {
    if (EXEMPT_SQL.some((rx) => rx.test(sql.replace(/\s+/g, " ")))) continue;
    assert.ok(
      /workspace_id/.test(sql),
      `an intake_events statement in ${file} is NOT workspace-scoped:\n${sql.trim().slice(0, 260)}`
    );
  }
});

test("both files are really scanned — the backfill is not invisible to this guard", () => {
  for (const file of SOURCES) {
    const touching = sqlBlocks(file).filter((s) => TOUCHES.test(s));
    assert.ok(touching.length > 0, `${file} holds no intake_events SQL — the guard is reading the wrong file`);
  }
});

test("every INSERT names workspace_id explicitly rather than defaulting it", () => {
  const inserts = SOURCES.flatMap((file) => sqlBlocks(file).filter((s) => /insert\s+into\s+intake_events/i.test(s)));
  assert.ok(inserts.length >= 2, `expected the store insert and the backfill insert, found ${inserts.length}`);
  for (const sql of inserts) {
    assert.match(sql, /INSERT INTO intake_events \([^)]*\bworkspace_id\b/i, "the insert must name workspace_id in its column list");
    // The seq derivation reads the table back. It must bind the tenant too, or two teams
    // sharing an intake id would interleave their sequences.
    assert.match(
      sql.replace(/\s+/g, " "),
      /MAX\(e\.seq\)[^)]*WHERE e\.intake_id = \? AND e\.workspace_id = \?/i,
      `the MAX(seq) sub-select must bind the tenant:\n${sql.trim().slice(0, 260)}`
    );
  }
});

test("the DELETE is keyed by intake_id AND workspace_id — a leaked intake id erases nothing elsewhere", () => {
  const deletes = SOURCES.flatMap((file) => sqlBlocks(file).filter((s) => /delete\s+from\s+intake_events/i.test(s)));
  assert.equal(deletes.length, 1, "intake_events has exactly one DELETE: the erasure door");
  assert.match(
    deletes[0].replace(/\s+/g, " ").trim(),
    /^DELETE FROM intake_events WHERE intake_id = \? AND workspace_id = \?$/i,
    `the erasure DELETE is not tenant-bound:\n${deletes[0]}`
  );
});
