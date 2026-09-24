// Acceptance cases for the one additive-column migrator (app/_lib/db/add-columns.ts) and
// for the callers converted onto it (core.ts's migrateExec, offers-store, scheduler-store,
// schedule-store).
//
// Cases 1-4 run the migrator directly — on a real in-memory SQLite handle behind an exec
// spy, or on a fake handle that throws a coded error on demand. Cases 5-6 are BOOTS, so they
// run in child `node` processes (a store memoizes its connection and ensureDb() memoizes on
// globalThis for the life of a process): the child patches better-sqlite3's
// Database.prototype.exec before importing anything, counts every `ALTER TABLE … ADD
// COLUMN` issued, and reports the count. Every database here is a throwaway temp file under
// this file's own private root; none of them is data/kp.sqlite. The root is not removed in an
// after() hook — the isolated stores hold handles Windows will not let us unlink.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import Database from "better-sqlite3";
import { addColumns, parseAddColumn, type ColumnMigrationDb } from "./add-columns.ts";

const ALTER_ADD = /ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN/i;

/** A real in-memory handle whose exec() records every statement it is given. */
function spied(d: Database.Database): { db: ColumnMigrationDb; execs: string[] } {
  const execs: string[] = [];
  const db: ColumnMigrationDb = {
    prepare: d.prepare.bind(d) as ColumnMigrationDb["prepare"],
    exec: ((sql: string) => {
      execs.push(sql);
      return d.exec(sql);
    }) as ColumnMigrationDb["exec"],
  };
  return { db, execs };
}

/** A fake handle: PRAGMA table_info answers from `columns`; exec() runs `onExec`. */
function fake(columns: string[], onExec: (sql: string) => void): { db: ColumnMigrationDb; execs: string[] } {
  const execs: string[] = [];
  const db = {
    prepare: () => ({ all: () => columns.map((name) => ({ name })) }),
    exec: (sql: string) => {
      execs.push(sql);
      onExec(sql);
      return db;
    },
  } as unknown as ColumnMigrationDb;
  return { db, execs };
}

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

// ---- 1. Probe, ALTER only what is missing, and a second call is silent ----------------
test("case 1: adds only the missing columns, returns their names, and a re-run issues zero ALTERs", () => {
  const d = new Database(":memory:");
  d.exec(`CREATE TABLE offers (id TEXT PRIMARY KEY, expires_at TEXT)`);
  const { db, execs } = spied(d);

  const first = addColumns(db, "offers", ["expires_at TEXT", "reminded_at TEXT", "ttl_days INTEGER"]);
  assert.deepEqual(first, ["reminded_at", "ttl_days"]);
  assert.equal(execs.filter((s) => ALTER_ADD.test(s)).length, 2, "exactly the two missing columns are ALTERed");

  const second = addColumns(db, "offers", ["expires_at TEXT", "reminded_at TEXT", "ttl_days INTEGER"]);
  assert.deepEqual(second, []);
  assert.equal(execs.length, 2, "the re-run on a migrated table issues NO statement at all");

  const cols = (d.prepare(`PRAGMA table_info(offers)`).all() as { name: string }[]).map((r) => r.name);
  assert.deepEqual(cols, ["id", "expires_at", "reminded_at", "ttl_days"]);
  d.close();
});

// ---- 2. A non-duplicate failure is re-thrown, named, and not memoized ------------------
// SQLITE_READONLY is the demonstrable swallowed class (a read-only file or mount);
// SQLITE_BUSY reaches an ALTER only after busy_timeout's 5 s expires under a held write
// lock, but it is the same class and must behave identically.
for (const [code, message] of [
  ["SQLITE_READONLY", "attempt to write a readonly database"],
  ["SQLITE_BUSY", "database is locked"],
] as const) {
  test(`case 2 (${code}): the ALTER failure is re-thrown naming table and column; nothing is swallowed or memoized`, () => {
    let failing = true;
    const columns = ["id"];
    const { db, execs } = fake(columns, (sql) => {
      if (failing) throw coded(code, message);
      const parsed = parseAddColumn(sql);
      if (parsed) columns.push(parsed.def.split(/\s+/)[0]);
    });

    assert.throws(
      () => addColumns(db, "offers", ["reminded_at TEXT"]),
      (err: unknown) => {
        const e = err as Error & { code?: unknown };
        assert.match(e.message, /offers/, "the table is named");
        assert.match(e.message, /reminded_at/, "the column is named");
        assert.match(e.message, new RegExp(message), "the underlying failure is kept");
        assert.equal(e.code, code, "the SQLite code survives the re-throw");
        return true;
      }
    );

    // Not memoized: once the cause clears, the very next call re-attempts and lands it.
    failing = false;
    assert.deepEqual(addColumns(db, "offers", ["reminded_at TEXT"]), ["reminded_at"]);
    assert.equal(execs.length, 2, "the failed ALTER was re-issued, not remembered as done");
  });
}

// ---- 3. A table that does not exist is named, not ALTERed -----------------------------
test("case 3: a missing table throws naming the table and attempts no ALTER", () => {
  const d = new Database(":memory:");
  const { db, execs } = spied(d);
  assert.throws(() => addColumns(db, "no_such_table", ["c TEXT"]), /no_such_table/);
  assert.equal(execs.length, 0, "no ALTER is attempted against a table that is not there");
  d.close();
});

// ---- 4. The concurrent-boot race: tolerated only when the re-probe confirms it ---------
test("case 4a: 'duplicate column name' with the column now present (another connection won) is tolerated", () => {
  const columns = ["id"];
  const { db, execs } = fake(columns, () => {
    columns.push("reminded_at"); // the other connection's ALTER landed first
    throw coded("SQLITE_ERROR", "duplicate column name: reminded_at");
  });
  assert.deepEqual(addColumns(db, "offers", ["reminded_at TEXT"]), [], "nothing was added BY US");
  assert.equal(execs.length, 1);
});

test("case 4b: 'duplicate column name' with the column STILL absent after re-probe is re-thrown", () => {
  const { db } = fake(["id"], () => {
    throw coded("SQLITE_ERROR", "duplicate column name: reminded_at");
  });
  assert.throws(() => addColumns(db, "offers", ["reminded_at TEXT"]), /offers.*reminded_at|reminded_at.*offers/);
});

// ---- child-process harness for the boot cases -----------------------------------------
const ROOT = mkdtempSync(path.join(os.tmpdir(), "kp-add-columns-"));

const CHILD = `
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.NODE_TEST_CONTEXT = "child-v8";
delete process.env.KP_MULTI_WORKSPACE;

const Database = (await import("better-sqlite3")).default;
let alters = 0;
const exec = Database.prototype.exec;
Database.prototype.exec = function (sql) {
  if (/ALTER\\s+TABLE\\s+\\w+\\s+ADD\\s+COLUMN/i.test(String(sql))) alters++;
  return exec.call(this, sql);
};
const load = (rel) => import(pathToFileURL(path.join(process.cwd(), rel)).href);
try {
  if (process.env.KP_CHILD_MODE === "core") {
    (await load("app/_lib/db/core.ts")).ensureDb();
  } else {
    (await load("app/_lib/offers-store.ts")).getOfferByToken("none");
    (await load("app/_lib/scheduler-store.ts")).hasVerifiedRun("none");
    (await load("app/_lib/schedule-store.ts")).getScheduleInviteByToken("none");
  }
  console.log("RESULT " + JSON.stringify({ ok: true, alters }));
} catch (error) {
  console.log("RESULT " + JSON.stringify({ ok: false, alters, error: error instanceof Error ? error.message : String(error) }));
}
`;

function runChild(dbPath: string, mode: "core" | "stores"): { ok: boolean; alters: number; error?: string } {
  const res = spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/test-alias-loader.mjs",
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      CHILD,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, KP_DB_PATH: dbPath, KP_CHILD_MODE: mode, NO_COLOR: "1", FORCE_COLOR: "0", KP_EMPTY: "1" },
    }
  );
  const m = /RESULT (.*)/.exec(res.stdout);
  assert.ok(m, `child reported no result\nstdout=${res.stdout}\nstderr=${res.stderr}`);
  return JSON.parse(m[1]);
}

function fresh(name: string): string {
  return path.join(mkdtempSync(path.join(ROOT, `${name}-`)), "kp.sqlite");
}

function columns(dbPath: string, table: string): string[] {
  const d = new Database(dbPath, { readonly: true });
  try {
    return (d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);
  } finally {
    d.close();
  }
}

function schemaOf(dbPath: string): string {
  const d = new Database(dbPath, { readonly: true });
  try {
    return JSON.stringify(d.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name`).all());
  } finally {
    d.close();
  }
}

// ---- 5. Three isolated stores over a legacy DB: migrate once, then silent --------------
const OFFERS_ADDED = ["workspace_id", "expires_at", "reminded_at", "ttl_days"];
const SCHEDULER_ADDED = ["reject_mode"];
const SCHEDULER_RUNS_ADDED = ["decisions_json"];
const INVITES_ADDED = [
  "slot_at", "reminder_sent_at", "reminder_attempts", "reminder_last_attempt_at", "needs_reconcile",
  "reconcile_reason", "needs_more_slots", "more_slots_flagged_at", "duration_min", "reschedule_count",
  "candidate_tz", "attendance_status", "attendance_at", "meeting_url", "workspace_id", "proposals",
  "proposals_at", "proposal_status", "calendar_event_id", "calendar_event_link", "calendar_event_state",
  "calendar_event_at",
];

test("case 5: offers/scheduler/schedule stores gain every column on a legacy DB, and a second process issues no ALTER", () => {
  const dbPath = fresh("stores");
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE offers (id TEXT PRIMARY KEY, token TEXT UNIQUE, entry_id TEXT, candidate_label TEXT, job_id TEXT,
      job_title TEXT, currency TEXT, salary INTEGER, payload_json TEXT, status TEXT NOT NULL DEFAULT 'extended',
      created_at TEXT NOT NULL, responded_at TEXT);
    CREATE TABLE scheduler (name TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
      interval_minutes INTEGER NOT NULL DEFAULT 15, last_run_at TEXT, next_due_at TEXT, last_summary_json TEXT,
      updated_at TEXT NOT NULL);
    CREATE TABLE scheduler_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, job TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'clock', status TEXT NOT NULL, summary_json TEXT, error TEXT,
      started_at TEXT NOT NULL, finished_at TEXT);
    CREATE TABLE schedule_invites (id TEXT PRIMARY KEY, token TEXT UNIQUE, entry_id TEXT, candidate_label TEXT,
      job_title TEXT, status TEXT NOT NULL DEFAULT 'pending', slot TEXT, created_at TEXT NOT NULL, confirmed_at TEXT);
  `);
  legacy.close();

  const first = runChild(dbPath, "stores");
  assert.equal(first.ok, true, `first open failed: ${first.error}`);
  for (const [table, want] of [
    ["offers", OFFERS_ADDED],
    ["scheduler", SCHEDULER_ADDED],
    ["scheduler_runs", SCHEDULER_RUNS_ADDED],
    ["schedule_invites", INVITES_ADDED],
  ] as const) {
    const have = new Set(columns(dbPath, table));
    for (const col of want) assert.ok(have.has(col), `${table} did not gain ${col}`);
  }
  assert.equal(first.alters, OFFERS_ADDED.length + SCHEDULER_ADDED.length + SCHEDULER_RUNS_ADDED.length + INVITES_ADDED.length);

  const second = runChild(dbPath, "stores");
  assert.equal(second.ok, true, `second open failed: ${second.error}`);
  assert.equal(second.alters, 0, "a second process opening the migrated file must issue no ALTER");
});

// ---- 6. core.ts: a warm boot issues zero ALTERs and leaves the schema identical --------
test("case 6: a second ensureDb() in a fresh process executes zero ALTERs and the schema is unchanged", () => {
  const dbPath = fresh("core");
  const first = runChild(dbPath, "core");
  assert.equal(first.ok, true, `first boot failed: ${first.error}`);
  const schema1 = schemaOf(dbPath);

  const second = runChild(dbPath, "core");
  assert.equal(second.ok, true, `warm boot failed: ${second.error}`);
  assert.equal(second.alters, 0, "a warm boot must not re-issue (and catch) every ADD COLUMN");
  assert.equal(schemaOf(dbPath), schema1, "the warm boot leaves the schema byte-identical");
});

test("parseAddColumn: splits an ADD COLUMN statement and ignores every other shape", () => {
  assert.deepEqual(parseAddColumn("ALTER TABLE llm_usage ADD COLUMN outcome TEXT NOT NULL DEFAULT 'ok'"), {
    table: "llm_usage",
    def: "outcome TEXT NOT NULL DEFAULT 'ok'",
  });
  assert.equal(parseAddColumn("CREATE INDEX IF NOT EXISTS idx_x ON t (c)"), null);
  assert.equal(parseAddColumn("ALTER TABLE a_new RENAME TO a"), null);
});
