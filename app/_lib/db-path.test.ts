// db-path.ts decides TWO things nothing tested: which backend the process is allowed to
// run on, and whether a `node --test` run is about to open the developer's real
// data/kp.sqlite.
//
// The second is the one with teeth. Test isolation used to hinge on unenforced IMPORT
// ORDER — a db-touching import evaluated before testing/unit-db.ts froze DB_PATH to the
// real file, and the test then seeded (or `INSERT OR REPLACE`-overwrote) a developer's
// actual database, silently. assertTestDbIsolated turns that into a loud throw. This
// file pins it, including the exact mis-ordered-import signature: KP_DB_PATH set AFTER
// the module froze DB_PATH, so the env and the constant disagree.
//
// It imports ./db-path.ts directly, never the ./db.ts barrel (the perf gate ratchets
// barrel importers), and opens nothing but a throwaway temp file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Freeze DB_PATH on an isolated file BEFORE the module loads — the very discipline the
// guard below exists to enforce.
const tmpDir = mkdtempSync(path.join(os.tmpdir(), "kp-dbpath-"));
const isolatedDb = path.join(tmpDir, "kp-test.sqlite");
process.env.KP_DB_PATH = isolatedDb;

const { DB_PATH, DEFAULT_DB_PATH, resolveDbBackend, openStore } = await import("./db-path.ts");

test("DB_PATH resolves the override to an absolute path, away from the developer's DB", () => {
  assert.equal(DB_PATH, path.resolve(isolatedDb));
  assert.notEqual(DB_PATH, DEFAULT_DB_PATH, "a test must never resolve to <cwd>/data/kp.sqlite");
});

test("resolveDbBackend accepts sqlite and only sqlite", () => {
  assert.equal(resolveDbBackend({}), "sqlite", "unset means the shipped backend");
  assert.equal(resolveDbBackend({ KP_DB_BACKEND: "  SQLite " }), "sqlite", "trimmed and case-folded");
  assert.throws(
    () => resolveDbBackend({ KP_DB_BACKEND: "mysql" }),
    /Unknown KP_DB_BACKEND 'mysql'/,
    "an unknown backend fails fast rather than silently opening SQLite",
  );
});

test("an ambient Postgres configuration never aborts a test run", () => {
  // Measured on 2026-08-26: a stray DATABASE_URL in the shell turned the suite red on
  // main while CI stayed green. A test run always wants a throwaway SQLite file, and
  // that holds for every spelling of "I configured Postgres".
  const cases: Readonly<Partial<NodeJS.ProcessEnv>>[] = [
    { KP_DB_BACKEND: "postgres" },
    { KP_DB_BACKEND: "postgresql" },
    { DATABASE_URL: "postgres://user:pw@host/db" },
    { DATABASE_URL: "POSTGRESQL://user:pw@host/db" },
    // …even one that also claims to be production: inTestRun wins, deliberately.
    { NODE_ENV: "production", DATABASE_URL: "postgres://user:pw@host/db" },
  ];
  for (const env of cases) {
    assert.equal(resolveDbBackend(env), "sqlite", `${JSON.stringify(env)} must not abort the suite`);
  }
});

// NOT PINNED HERE, and deliberately named rather than quietly skipped: the production
// arm, where a Postgres configuration THROWS with a pointer at
// docs/architecture/postgres-backend.md. `inTestRun` reads `process.execArgv` as well as
// the env object it is handed, and every `node --test` process carries `--test*` there —
// so from inside this suite the Postgres branch is unreachable no matter what env is
// passed, and an assertion claiming to cover it would be asserting the escape hatch
// above under a misleading name. Reaching it needs a child process without the test
// flags. The unknown-backend throw below shares the parsing and IS reachable.

test("openStore opens the isolated file when the frozen path and the env agree", () => {
  const db = openStore();
  try {
    assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1, "FKs are ON per connection, never inherited");
  } finally {
    db.close();
  }
});

test("openStore REFUSES to open when a test run's KP_DB_PATH no longer matches the frozen DB_PATH", () => {
  // The mis-ordered-import signature: something set KP_DB_PATH after db-path.ts froze
  // DB_PATH. Opening anyway is how a test used to overwrite the real developer DB.
  const prev = process.env.KP_DB_PATH;
  try {
    process.env.KP_DB_PATH = path.join(tmpDir, "somewhere-else.sqlite");
    assert.throws(() => openStore(), /refusing to open the database in a test run/i);
    delete process.env.KP_DB_PATH;
    assert.throws(
      () => openStore(),
      /Import "app\/_lib\/testing\/unit-db\.ts" as the FIRST project import/,
      "and an unset override names the fix rather than just failing",
    );
  } finally {
    process.env.KP_DB_PATH = prev;
  }
});

test.after(() => rmSync(tmpDir, { recursive: true, force: true }));
