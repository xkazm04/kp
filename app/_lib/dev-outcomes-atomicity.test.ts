// An outcome is recorded ONCE — the concurrency half of the dev-outcomes contract.
//
// `recordOutcome` reads the row it is "about" and then inserts or updates. Until
// /perfect wave 28 those were two bare statements: nothing held a lock between them and
// nothing in the schema forbade the result. A recruiter rating a hire in the pipeline
// drawer (recordHirePerformance) while the pipeline auto-records the SAME terminal
// transition (recordPipelineOutcome) therefore had both writers read "no row" and both
// insert — two decided rows for one real-world fact. calibrate() counts decided rows
// individually and MIN RESOLVED is 4, so the store's own header says a single duplicate
// can move the suggested promote floor a whole tier. That is a wrong number on the
// screen whose button moves the live floor.
//
// TWO layers pin the fix, and they are different claims:
//
//  1. SOURCE: both writers really do wrap their read→write in `.immediate()` — the write
//     lock is taken at BEGIN, not at the first write — and neither body awaits (an await
//     inside a better-sqlite3 transaction gives the atomicity away with no error).
//  2. BEHAVIOUR: the race, actually run. Two `Database` handles on one file replay the
//     exact SELECT → (the other writer inserts) → INSERT ordering, using the INSERT
//     STATEMENT EXTRACTED FROM dev-outcomes.ts, so the two layers cannot drift into
//     describing different SQL. The unguarded control at the bottom is the non-vacuity:
//     with the partial UNIQUE index absent, the identical sequence yields two rows.
//
// The transaction is the fix on ONE connection; the partial UNIQUE index
// (workspace_id, ref, outcome) WHERE ref IS NOT NULL is what holds across the several
// connections this store is opened on (db.ts, dev-control and this module each hold
// their own handle on kp.sqlite). Both are asserted here.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const SOURCE = readFileSync(fileURLToPath(new URL("./dev-outcomes.ts", import.meta.url)), "utf8");

/** The body of a top-level `function`/`export function <name>(` up to the next top-level one. */
function functionBody(name: string): string {
  const start = SOURCE.search(new RegExp(`^(export )?function ${name}\\(`, "m"));
  assert.notEqual(start, -1, `${name} not found — did it get renamed?`);
  const rest = SOURCE.slice(start + 1);
  const end = rest.search(/^(export )?function /m);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Statements only. The bodies here are heavily commented and those comments QUOTE the
 *  rule being pinned ("an await here would silently give the atomicity away"), so a
 *  naive scan for `await` matches the prose that explains why there is none. */
function code(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

// ── Layer 1: the source contract ──────────────────────────────────────────────

for (const name of ["recordOutcome", "recordPipelineOutcome"]) {
  test(`${name} runs its read→write inside an IMMEDIATE transaction`, () => {
    const body = functionBody(name);
    assert.match(
      body,
      /\.transaction\(/,
      `${name} must wrap its read and its write in one db.transaction — otherwise a concurrent writer slips between them`
    );
    assert.match(
      body,
      /\.immediate\(\)/,
      `${name}'s transaction must be .immediate() — a DEFERRED transaction takes the write lock at the first WRITE, which is after the read that decides insert-vs-update`
    );
  });

  test(`${name} never awaits inside its transaction`, () => {
    // better-sqlite3 is synchronous; an await between BEGIN and COMMIT yields the event
    // loop and the atomicity is gone with no error and no failing test.
    assert.doesNotMatch(code(functionBody(name)), /\bawait\b/, `${name} must stay synchronous`);
  });
}

test("the migrator declares the partial UNIQUE index that backs the transaction", () => {
  const idx = SOURCE.match(/CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_outcomes_ref_unique[^`]*/);
  assert.ok(idx, "the cross-connection backstop index must exist in db()");
  const sql = idx[0].replace(/\s+/g, " ");
  assert.match(sql, /\(workspace_id, ref, outcome\)/, "keyed on the row's real identity");
  assert.match(
    sql,
    /WHERE ref IS NOT NULL/,
    "PARTIAL — a refless control-room entry legitimately repeats (two people, one name, one outcome)"
  );
});

// ── Layer 2: the race, actually run ───────────────────────────────────────────

const RACE_DIR = mkdtempSync(path.join(os.tmpdir(), "kp-outcome-race-"));
after(() => rmSync(RACE_DIR, { recursive: true, force: true }));

/** The columns the shipped INSERT touches, on a throwaway file. `withIndex: false` is
 *  the unguarded control — the identical table WITHOUT the constraint. */
function raceDb(name: string, withIndex: boolean): Database.Database {
  const file = path.join(RACE_DIR, `${name}.sqlite`);
  const setup = new Database(file);
  setup.pragma("journal_mode = WAL");
  setup.exec(`CREATE TABLE dev_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT, candidate_ref TEXT, predicted_score INTEGER,
    outcome TEXT NOT NULL, performance INTEGER, note TEXT, recorded_at TEXT NOT NULL,
    workspace_id TEXT NOT NULL DEFAULT 'workspace', source TEXT
  );`);
  if (withIndex) {
    const idx = SOURCE.match(/CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_outcomes_ref_unique[^`]*/);
    assert.ok(idx, "the index statement must be readable from the store");
    setup.exec(idx[0]);
  }
  setup.close();
  return new Database(file);
}

/** The INSERT the store actually runs, taken verbatim from dev-outcomes.ts. */
function shippedInsert(): string {
  const m = SOURCE.match(/INSERT INTO dev_outcomes \(ref,[\s\S]*?recorded_at = excluded\.recorded_at/);
  assert.ok(m, "the upsert statement must be findable — did the INSERT get rewritten?");
  return m[0];
}

/** One writer's arguments: the drawer's rating and the pipeline's auto-record name the
 *  SAME hire under the SAME ref (hireOutcomeRef mirrors recordPipelineOutcome's
 *  derivation precisely so that they collide here rather than in production). */
const ARGS = (source: string, perf: number | null) =>
  ["sub_race", "Ada Lovelace", 91, "hired", perf, null, "2026-09-04T10:00:00.000Z", "workspace", source] as const;

test("two connections racing one hire collapse to a single decided row", () => {
  const a = raceDb("guarded", true);
  const b = new Database(a.name);
  try {
    // A: the read that decides insert-vs-update. It sees nothing.
    const seen = a.prepare(`SELECT id FROM dev_outcomes WHERE workspace_id = ? AND ref = ?`).all("workspace", "sub_race");
    assert.equal(seen.length, 0, "fixture setup: A must start from an empty key");

    // B: the OTHER writer — the pipeline auto-recording the same terminal transition
    // inside the window A's read left open.
    b.prepare(shippedInsert()).run(...ARGS("auto", null));

    // A: the INSERT it decided on, against the constraint.
    a.prepare(shippedInsert()).run(...ARGS("manual", 4));

    const rows = a.prepare(`SELECT source, performance FROM dev_outcomes WHERE ref = 'sub_race'`).all() as {
      source: string;
      performance: number | null;
    }[];
    assert.equal(rows.length, 1, "one real-world hire is ONE decided row — calibrate() counts each row it sees");
    assert.equal(rows[0].performance, 4, "the loser's rating merges into the winner's row rather than being lost");
    assert.equal(rows[0].source, "auto", "provenance belongs to the row's FIRST writer and is never rewritten");
  } finally {
    a.close();
    b.close();
  }
});

test("a refless row is exempt — the constraint is partial on purpose", () => {
  const a = raceDb("refless", true);
  try {
    const ins = a.prepare(shippedInsert());
    ins.run(null, "Jan Novak", 60, "hired", null, null, "2026-09-04T10:00:00.000Z", "workspace", "manual");
    ins.run(null, "Jan Novak", 60, "hired", null, null, "2026-09-04T10:01:00.000Z", "workspace", "manual");
    const n = a.prepare(`SELECT COUNT(*) AS n FROM dev_outcomes WHERE ref IS NULL`).get() as { n: number };
    assert.equal(n.n, 2, "two different people can share a name and an outcome — without a ref they are not the same row");
  } finally {
    a.close();
  }
});

// Non-vacuity: the PRE-wave-28 shape of the same write — the identical INSERT with its
// ON CONFLICT clause stripped, against the identical table with no constraint — and the
// identical interleaving. It produces the duplicate. If this ever stops producing two
// rows, the test above is proving nothing.
test("without the partial UNIQUE index, the identical sequence double-counts the hire", () => {
  const a = raceDb("unguarded", false);
  const b = new Database(a.name);
  try {
    const bare = shippedInsert().replace(/\s*ON CONFLICT[\s\S]*$/, "");
    assert.doesNotMatch(bare, /ON CONFLICT/, "the control must actually have the upsert clause removed");
    a.prepare(`SELECT id FROM dev_outcomes WHERE workspace_id = ? AND ref = ?`).all("workspace", "sub_race");
    b.prepare(bare).run(...ARGS("auto", null));
    a.prepare(bare).run(...ARGS("manual", 4));
    const n = a.prepare(`SELECT COUNT(*) AS n FROM dev_outcomes WHERE ref = 'sub_race'`).get() as { n: number };
    assert.equal(n.n, 2, "two decided rows for one hire — exactly the bug, reproduced");
  } finally {
    a.close();
    b.close();
  }
});

// ── The legacy backfill, run against a real legacy table ──────────────────────
//
// The `source` column replaces two English sentences that used to be persisted into
// `note` and pattern-matched by the control room. Existing installs hold those rows, so
// the migration reads the very prefix the panel used to test. The statement is extracted
// from the migrator rather than retyped.
test("the source backfill reads provenance out of the legacy English notes", () => {
  const d = raceDb("backfill", false);
  try {
    const ins = d.prepare(
      `INSERT INTO dev_outcomes (ref, outcome, note, recorded_at, workspace_id) VALUES (?, 'hired', ?, '2026-01-01', 'workspace')`
    );
    ins.run("r_auto", "auto-recorded from pipeline hire");
    ins.run("r_drawer", "on-the-job rating recorded in the pipeline drawer");
    ins.run("r_bare", null);
    d.exec(`UPDATE dev_outcomes SET source = NULL`);

    const backfill = SOURCE.match(/UPDATE dev_outcomes SET source = CASE[^`]*?WHERE source IS NULL/);
    assert.ok(backfill, "the backfill statement must be findable in the migrator");
    d.exec(backfill[0]);

    const byRef = Object.fromEntries(
      (d.prepare(`SELECT ref, source FROM dev_outcomes`).all() as { ref: string; source: string }[]).map((r) => [r.ref, r.source])
    );
    assert.equal(byRef.r_auto, "auto", "the pipeline's own sentence is the only 'auto' tell a legacy row carries");
    assert.equal(byRef.r_drawer, "manual", "a human wrote the drawer rating — 'auto' would be a fabrication");
    assert.equal(byRef.r_bare, "manual", "an unattributable legacy row reads as human, never as machine");
  } finally {
    d.close();
  }
});
