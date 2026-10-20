// Source-level guard for the close/reopen PAIR's lost-update protection.
//
// closeEntriesByJobId and reopenEntriesByJobId both run a SELECT, then loop
// UPDATEing each selected row. Both shipped DEFERRED — the write lock taken at the
// first write, not at BEGIN — which means the status each SELECT filtered on could
// change under the loop. The first thing standing between that and a lost update
// is the UPDATE re-asserting the status it read.
//
// reopen shipped with that guard; close shipped without it, so a hire (or a human
// merit reject) landing between close's SELECT and a row's UPDATE was overwritten
// to `role_closed` and given a withdrawal event it never earned.
//
// Both now ALSO run `.immediate()` — the other valid strategy in this file, the
// write lock held from BEGIN. That is not belt-and-braces for its own sake: inside a
// real DEFERRED transaction the cross-connection race does not degrade to the guard's
// no-op at all. SQLite refuses to upgrade a read snapshot that another connection has
// since written past — SQLITE_BUSY_SNAPSHOT, which busy_timeout never retries — so the
// whole close/reopen rolled back and the route answered withdrawalFailed / left the
// entries stranded on a live role. The guard replay below runs its statements in
// autocommit, which is exactly why it never saw that; the last section of this file
// runs both transaction shapes for real.
//
// THREE layers pin it, and they are different claims:
//
//  1. SOURCE (below): the guard clause is PRESENT in the shipped statement — the way
//     this repo already pins the rate-limit call sites and the tenancy predicates.
//  2. BEHAVIOUR (bottom of this file): the race, actually run. This header used to say
//     the window was "not reproducible from a single-threaded test". That is true only
//     of interleaving INSIDE the transaction — better-sqlite3 is synchronous, so no
//     second writer gets a turn between two statements of one tx. It is NOT true of the
//     race itself: two `Database` handles on one file reproduce the exact
//     SELECT → (another connection flips the row) → UPDATE ordering, and the
//     behavioural test runs the statement EXTRACTED FROM pipeline.ts against it — so
//     the two layers cannot drift into describing different SQL.
//
//  3. LOCKING (bottom of this file): `.immediate()` is present at the source, and on
//     two live connections the DEFERRED control aborts with SQLITE_BUSY_SNAPSHOT while
//     the shipped IMMEDIATE shape completes with an exact count.
//
// The guard is kept under IMMEDIATE on purpose: a caller that nests either function
// inside an outer transaction gets a SAVEPOINT (better-sqlite3 ignores the inner
// mode), and the re-assert is what still holds there. Removing either layer is a
// deliberate decision, and this test should be updated to say so, not deleted.
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

/** Bind the EXTRACTED statement's `?` placeholders by the column each one sits against,
 *  rather than by a hand-counted positional list.
 *
 *  The replay below runs the shipped SQL verbatim, so its parameter arity is whatever the
 *  shipped SQL currently has — and it changed the moment close's UPDATE grew its second
 *  guard (`AND stage != ?`, the terminal-column re-assert). A positional `.run(a, b, c)`
 *  broke at that point with `Too few parameter values`, which is a harness failure dressed
 *  up as a guard failure. Reading the column names out of the statement means a future
 *  guard either binds automatically or fails with a message that names the placeholder
 *  nobody supplied. */
function bindParams(sql: string, values: Record<string, unknown>): unknown[] {
  const columns = [...sql.matchAll(/([A-Za-z_]+)\s*(?:=|!=|<>)\s*\?/g)].map((m) => m[1]);
  assert.ok(columns.length > 0, `no bindable placeholders found in the extracted statement:\n${sql}`);
  return columns.map((c) => {
    assert.ok(c in values, `the replay has no value for the '${c}' placeholder — add one to the fixture`);
    return values[c];
  });
}

/** The fixture's values, keyed by the column each binds to. `stage` is the TERMINAL
 *  column close resolves by role: the fixture row sits on 'Screen', so `stage != ?`
 *  passes and the STATUS guard is what these cases are actually measuring. The stage
 *  guard's own race has its own file (pipeline-close-stage.test.ts). */
const REPLAY_VALUES: Record<string, unknown> = {
  updated_at: "2026-01-02",
  id: "e1",
  stage: "Hired",
  workspace_id: "workspace",
};

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

// ── The race, actually run ─────────────────────────────────────────────────────
//
// Two better-sqlite3 handles on ONE file, replaying the exact statement ordering the
// close/reopen loops perform: connection A SELECTs the rows it intends to flip,
// connection B (a recruiter hitting Hire on the board, or a reopen landing on a close)
// flips one of them, and A then issues its guarded UPDATE for that row. The guard makes
// A's write a no-op — `changes === 0`, which the shipped loop turns into `continue`, so
// no bogus event and no inflated count either.
//
// The UPDATE is EXTRACTED FROM pipeline.ts, not retyped, so this cannot pass against a
// statement the app no longer runs. The unguarded control below is the non-vacuity: with
// the guard clause stripped, the SAME sequence silently overwrites the hire — the exact
// bug, reproduced.
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { after } from "node:test";

const RACE_DIR = mkdtempSync(path.join(os.tmpdir(), "kp-close-race-"));
after(() => rmSync(RACE_DIR, { recursive: true, force: true }));

/** The columns the two guarded statements touch, on a throwaway file. Deliberately a
 *  minimal table: the subject is the WHERE clause, and boot's full schema would drag
 *  seeding and migrations into a test about four columns. */
function raceDb(name: string): Database.Database {
  const file = path.join(RACE_DIR, `${name}.sqlite`);
  const setup = new Database(file);
  setup.pragma("journal_mode = WAL");
  setup.exec(`CREATE TABLE pipeline_entries (
    id TEXT PRIMARY KEY, candidate_label TEXT NOT NULL, job_title TEXT, archetype TEXT,
    stage TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', approval_kind TEXT, updated_at TEXT,
    workspace_id TEXT NOT NULL DEFAULT 'workspace'
  );`);
  setup.close();
  return new Database(file);
}

type RaceCase = {
  fn: "closeEntriesByJobId" | "reopenEntriesByJobId";
  /** What the SELECT filtered on — the status the row starts in. */
  from: string;
  /** What the OTHER connection flips it to mid-window. */
  concurrent: string;
};

const CASES: RaceCase[] = [
  // A hire (or a human merit reject) lands while a role close is walking its rows.
  { fn: "closeEntriesByJobId", from: "active", concurrent: "hired" },
  // The mirror: a terminal decision lands on a closed entry while a reopen is walking
  // its rows — the reopen must not drag that entry back to active.
  { fn: "reopenEntriesByJobId", from: "role_closed", concurrent: "hired" },
];

for (const { fn, from, concurrent } of CASES) {
  test(`${fn}: a concurrent status change on another connection makes the guarded UPDATE a no-op`, () => {
    const a = raceDb(fn);
    const b = new Database(a.name);
    try {
      a.prepare(
        `INSERT INTO pipeline_entries (id, candidate_label, stage, status, updated_at) VALUES ('e1', 'Candidate', 'Screen', ?, '2026-01-01')`
      ).run(from);

      // A: the SELECT the loop reads its work from. It sees the row in `from`.
      const seen = a
        .prepare(`SELECT id, status FROM pipeline_entries WHERE status = ? AND id = 'e1'`)
        .all(from) as { id: string; status: string }[];
      assert.equal(seen.length, 1, "fixture setup: A must have the row in its work list");

      // B: the concurrent writer, inside the window A's DEFERRED transaction leaves open
      // between its SELECT and its first write.
      b.prepare(`UPDATE pipeline_entries SET status=? WHERE id='e1'`).run(concurrent);

      // A: the guarded UPDATE, taken verbatim from the shipped function.
      const sql = pipelineUpdates(functionBody(fn))[0];
      const res = a.prepare(sql).run(...bindParams(sql, REPLAY_VALUES));
      assert.equal(res.changes, 0, "the guard must make A's write a no-op — this is the lost update it exists to prevent");

      const now = a.prepare(`SELECT status FROM pipeline_entries WHERE id='e1'`).get() as { status: string };
      assert.equal(now.status, concurrent, `the concurrent writer's '${concurrent}' must survive intact`);
    } finally {
      a.close();
      b.close();
    }
  });
}

// Non-vacuity for both cases above: strip the guard clause out of the SAME extracted
// statement and the SAME sequence loses the update. If this ever stops failing to
// overwrite, the tests above are proving nothing.
test("without the guard, the identical sequence silently overwrites the concurrent change", () => {
  for (const { fn, from, concurrent } of CASES) {
    const a = raceDb(`${fn}-unguarded`);
    const b = new Database(a.name);
    try {
      a.prepare(
        `INSERT INTO pipeline_entries (id, candidate_label, stage, status, updated_at) VALUES ('e1', 'Candidate', 'Screen', ?, '2026-01-01')`
      ).run(from);
      a.prepare(`SELECT id FROM pipeline_entries WHERE status = ?`).all(from);
      b.prepare(`UPDATE pipeline_entries SET status=? WHERE id='e1'`).run(concurrent);

      const unguarded = pipelineUpdates(functionBody(fn))[0].replace(new RegExp(`\\s*AND status='${from}'`), "");
      assert.doesNotMatch(unguarded, new RegExp(`status='${from}'`), "the control must actually have the guard removed");
      const res = a.prepare(unguarded).run(...bindParams(unguarded, REPLAY_VALUES));

      assert.equal(res.changes, 1, "the unguarded statement writes — that is the bug");
      const now = a.prepare(`SELECT status FROM pipeline_entries WHERE id='e1'`).get() as { status: string };
      assert.notEqual(now.status, concurrent, `the concurrent '${concurrent}' was clobbered, exactly as it was in production`);
    } finally {
      a.close();
      b.close();
    }
  }
});

// ── The lock, actually taken ───────────────────────────────────────────────────
//
// The replay above runs A's statements in autocommit, so it measures the WHERE clause
// and nothing else. The shipped functions run them inside one transaction, and the
// transaction's MODE decides what the same interleaving does:
//
//   DEFERRED  A's SELECT opens a read snapshot; B commits; A's UPDATE must upgrade to
//             a write lock on a snapshot that is no longer current → SQLite answers
//             SQLITE_BUSY_SNAPSHOT at once (busy_timeout is NOT consulted), the
//             transaction rolls back, and the caller gets a throw — not `changes === 0`.
//   IMMEDIATE A holds the write lock from BEGIN; B's write waits its own busy_timeout
//             (kp's stores set 5000 ms) and lands AFTER A commits, seeing the close.
//
// Single-threaded, B cannot outwait A, so here B's busy_timeout is short and B's write
// is the SQLITE_BUSY it would be after 5 s in production — the point is that A's close
// COMPLETES and B's later retry sees `role_closed`, the opposite of the control.

/** The transaction shape of a top-level function: does it commit through
 *  `tx.immediate()` or a bare `tx()`? */
function transactionMode(body: string): "immediate" | "deferred" | "unknown" {
  if (/return tx\.immediate\(\);/.test(body)) return "immediate";
  if (/return tx\(\);/.test(body)) return "deferred";
  return "unknown";
}

for (const name of ["closeEntriesByJobId", "reopenEntriesByJobId"] as const) {
  test(`${name} commits through tx.immediate(), taking the write lock at BEGIN`, () => {
    assert.equal(
      transactionMode(functionBody(name)),
      "immediate",
      `${name} must run .immediate() — a DEFERRED read→write aborts with SQLITE_BUSY_SNAPSHOT under a concurrent writer`
    );
  });
}

test("the mode matcher tells the two shapes apart", () => {
  assert.equal(transactionMode("  return tx();\n}"), "deferred");
  assert.equal(transactionMode("  return tx.immediate();\n}"), "immediate");
});

const SEED_ROW = `INSERT INTO pipeline_entries (id, candidate_label, stage, status, updated_at) VALUES ('e1', 'Candidate', 'Screen', ?, '2026-01-01')`;

/** The shipped loop's shape for one row on connection `a`, with connection `b`
 *  committing in the window between the SELECT and the UPDATE. Returns the guarded
 *  UPDATE's change count; throws whatever SQLite throws. */
function replayInTransaction(a: Database.Database, b: Database.Database, fn: RaceCase["fn"], from: string, concurrent: string) {
  const sql = pipelineUpdates(functionBody(fn))[0];
  return a.transaction((): number => {
    const seen = a.prepare(`SELECT id FROM pipeline_entries WHERE status = ? AND id = 'e1'`).all(from);
    assert.equal(seen.length, 1, "fixture setup: A must have the row in its work list");
    b.prepare(`UPDATE pipeline_entries SET status=? WHERE id='e1'`).run(concurrent);
    return a.prepare(sql).run(...bindParams(sql, REPLAY_VALUES)).changes;
  });
}

for (const { fn, from, concurrent } of CASES) {
  test(`${fn}: DEFERRED, the same race is a SQLITE_BUSY_SNAPSHOT abort — the control`, () => {
    const a = raceDb(`${fn}-deferred`);
    const b = new Database(a.name);
    try {
      a.pragma("busy_timeout = 5000"); // the production setting — and it does not help here
      a.prepare(SEED_ROW).run(from);
      assert.throws(
        () => replayInTransaction(a, b, fn, from, concurrent)(),
        (err: unknown) => (err as { code?: string }).code === "SQLITE_BUSY_SNAPSHOT",
        "a DEFERRED read→write under a concurrent commit must abort with SQLITE_BUSY_SNAPSHOT — the 500 the shipped shape used to answer"
      );
      assert.equal(a.inTransaction, false, "the abort rolled the whole transaction back");
    } finally {
      a.close();
      b.close();
    }
  });

  test(`${fn}: IMMEDIATE, the write lock is held from BEGIN and the close completes`, () => {
    const a = raceDb(`${fn}-immediate`);
    const b = new Database(a.name);
    try {
      a.pragma("busy_timeout = 5000");
      b.pragma("busy_timeout = 50"); // B waits, as it would for 5 s in production; single-threaded it cannot outwait A
      a.prepare(SEED_ROW).run(from);
      const sql = pipelineUpdates(functionBody(fn))[0];
      let bRefused: string | undefined;
      const changes = a
        .transaction((): number => {
          a.prepare(`SELECT id FROM pipeline_entries WHERE status = ? AND id = 'e1'`).all(from);
          try {
            b.prepare(`UPDATE pipeline_entries SET status=? WHERE id='e1'`).run(concurrent);
          } catch (err) {
            bRefused = (err as { code?: string }).code;
          }
          return a.prepare(sql).run(...bindParams(sql, REPLAY_VALUES)).changes;
        })
        .immediate();
      assert.equal(bRefused, "SQLITE_BUSY", "B must have been made to wait for A's lock rather than committing under it");
      assert.equal(changes, 1, "A's guarded write lands: the rows it read are the rows it writes");
      // B's retry, after A committed, sees the close — the later writer is not the loser.
      const target = from === "active" ? "role_closed" : "active";
      const after = b.prepare(`SELECT status FROM pipeline_entries WHERE id='e1'`).get() as { status: string };
      assert.equal(after.status, target, "B's next read sees A's committed write");
    } finally {
      a.close();
      b.close();
    }
  });
}
