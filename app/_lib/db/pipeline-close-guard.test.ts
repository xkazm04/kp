// Source-level guard for the close/reopen PAIR's lost-update protection.
//
// closeEntriesByJobId and reopenEntriesByJobId both run a SELECT, then loop
// UPDATEing each selected row. Both transactions are DEFERRED, so the write lock
// is taken at the first write, not at BEGIN — which means the status each SELECT
// filtered on can change under the loop. The only thing standing between that and
// a lost update is the UPDATE re-asserting the status it read.
//
// reopen shipped with that guard; close shipped without it, so a hire (or a human
// merit reject) landing between close's SELECT and a row's UPDATE was overwritten
// to `role_closed` and given a withdrawal event it never earned. The race window
// is real but not reproducible from a single-threaded test — better-sqlite3 is
// synchronous, so no second writer can interleave inside the transaction here.
// Pin the invariant at the source level instead, the way this repo already pins
// the rate-limit call sites and the tenancy predicates: assert the guard is
// PRESENT in the statement, not merely that the behaviour looks right on a board
// nobody else is touching.
//
// If a future change moves either function to `.immediate()` — taking the write
// lock at BEGIN, the other valid strategy in this file — that is a deliberate
// decision, and this test should be updated to assert THAT instead of deleted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = readFileSync(fileURLToPath(new URL("./pipeline.ts", import.meta.url)), "utf8");

/** The body of a top-level `export function <name>(` up to the next top-level one. */
function functionBody(name: string): string {
  const start = SOURCE.indexOf(`export function ${name}(`);
  assert.notEqual(start, -1, `${name} not found — did it get renamed?`);
  const rest = SOURCE.slice(start + 1);
  const end = rest.indexOf("\nexport ");
  return end === -1 ? rest : rest.slice(0, end);
}

/** Every UPDATE statement on pipeline_entries inside one function body. */
function pipelineUpdates(body: string): string[] {
  return [...body.matchAll(/UPDATE pipeline_entries SET [^`]*/g)].map((m) => m[0].replace(/\s+/g, " ").trim());
}

test("closeEntriesByJobId re-asserts status='active' on the row it read", () => {
  const updates = pipelineUpdates(functionBody("closeEntriesByJobId"));
  assert.equal(updates.length, 1, `expected exactly one UPDATE, saw ${updates.length}: ${updates.join(" | ")}`);
  assert.match(
    updates[0],
    /status='active'/,
    "close's UPDATE must carry `AND status='active'` — without it a concurrent hire is overwritten to role_closed"
  );
});

test("reopenEntriesByJobId re-asserts status='role_closed' on the row it read", () => {
  const updates = pipelineUpdates(functionBody("reopenEntriesByJobId"));
  assert.equal(updates.length, 1, `expected exactly one UPDATE, saw ${updates.length}: ${updates.join(" | ")}`);
  assert.match(
    updates[0],
    /status='role_closed'/,
    "reopen's UPDATE must carry `AND status='role_closed'` — the guard that makes a lost race a no-op"
  );
});

test("both functions skip the event and the count when the guarded UPDATE changes nothing", () => {
  for (const name of ["closeEntriesByJobId", "reopenEntriesByJobId"]) {
    const body = functionBody(name);
    assert.match(
      body,
      /res\.changes === 0/,
      `${name} must check res.changes — a guarded UPDATE that matched nothing must not record an event or increment the count`
    );
  }
});

// Non-vacuity: the matcher must actually reject an unguarded statement, or the
// three assertions above would pass against the very bug they exist to catch.
test("the guard matcher rejects an unguarded UPDATE", () => {
  const unguarded = "UPDATE pipeline_entries SET status='role_closed', updated_at=? WHERE id=? AND workspace_id=?";
  assert.doesNotMatch(unguarded, /status='active'/);
});
