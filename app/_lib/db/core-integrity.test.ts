// Boot refuses to serve a structurally broken database.
//
// db-path.ts pinned WAL, synchronous and busy_timeout, but nothing ever asked SQLite
// whether the file it just opened is still a database. A corrupt page, a truncated
// copy, a half-restored backup — all of them opened cleanly and served requests until
// some unrelated query tripped over the damage, surfacing as a random 500 in whichever
// feature happened to read the broken page first. Worse: the boot DDL/migrations would
// WRITE into that file before anyone noticed.
//
// ensureDb() now runs `PRAGMA quick_check(1)` ONCE on the memoized boot connection and
// throws DB_INTEGRITY_FAILED on any non-`ok` answer. Two damage shapes are pinned here
// because SQLite reports them differently: page corruption answers a non-`ok` ROW, and
// a file that is not a database at all makes the pragma THROW (SQLITE_NOTADB).
//
// Driven in child `node` processes, like core-seed-marks.test.ts: a genuine BOOT is the
// subject, and ensureDb() memoizes on globalThis for the life of a process. Every DB
// here is a throwaway temp file; none of them is data/kp.sqlite.
//
// NON-VACUITY: the healthy case at the bottom must boot cleanly, or "refuses to boot"
// would pass against a seam that simply refuses always.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, openSync, readFileSync, rmSync, writeSync, closeSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// Boots core.ts against whatever KP_DB_PATH it is handed and reports whether ensureDb()
// completed. KP_EMPTY keeps the fixture corpus out of it — this test is about the file,
// not the seed.
const BOOT_CHILD = `
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.NODE_TEST_CONTEXT = "child-v8";
delete process.env.KP_MULTI_WORKSPACE;

const core = await import(pathToFileURL(path.join(process.cwd(), "app/_lib/db/core.ts")).href);
try {
  core.ensureDb();
  console.log("BOOT ok");
} catch (error) {
  console.log("BOOT refused " + (error instanceof Error ? error.message : String(error)));
}
`;

type Boot = { ok: boolean; message: string; stderr: string };

function boot(dbPath: string, env: Record<string, string> = {}): Boot {
  const res = spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/test-alias-loader.mjs",
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      BOOT_CHILD,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      // Inherited FORCE_COLOR would wrap stdout in escape codes and break the match.
      env: { ...process.env, KP_DB_PATH: dbPath, NO_COLOR: "1", FORCE_COLOR: "0", KP_EMPTY: "1", ...env },
    }
  );
  const m = /BOOT (ok|refused)(.*)/.exec(res.stdout);
  assert.ok(m, `child reported no boot verdict\nstdout=${res.stdout}\nstderr=${res.stderr}`);
  return { ok: m[1] === "ok", message: m[2].trim(), stderr: res.stderr };
}

/** A healthy, fully-initialized kp database with its WAL folded back into the file. */
function seedHealthyDb(dbPath: string): void {
  const first = boot(dbPath);
  assert.ok(first.ok, `fixture setup: a fresh DB must boot, saw: ${first.message}`);
  // Fold the -wal back in so the damage below lands in the pages SQLite will actually
  // read (a still-live WAL would shadow the corrupted main-file pages).
  const db = new Database(dbPath);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
}

test("boot refuses to serve a database with a corrupted page", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-integrity-"));
  const dbPath = path.join(dir, "corrupt.sqlite");
  try {
    seedHealthyDb(dbPath);
    const size = statSync(dbPath).size;
    assert.ok(size > 16384, `fixture setup: expected a multi-page database, saw ${size} bytes`);

    // Scribble over interior b-tree pages, leaving page 1 (the header + schema root)
    // intact — so the file still opens as a database and the damage is exactly what
    // quick_check exists to find.
    const fd = openSync(dbPath, "r+");
    writeSync(fd, Buffer.alloc(4096, 0x5a), 0, 4096, 4096);
    writeSync(fd, Buffer.alloc(4096, 0x5a), 0, 4096, 8192);
    closeSync(fd);

    const after = boot(dbPath);
    assert.equal(after.ok, false, "a corrupted database must not boot");
    assert.match(after.message, /DB_INTEGRITY_FAILED/, "the refusal carries the code an operator can search for");
    assert.match(after.stderr, /DB_INTEGRITY_FAILED/, "and it is logged, not only thrown");
    assert.match(after.stderr, /quick_check/, "the log names the check that failed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("boot refuses to serve a file that is not a SQLite database at all", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-notadb-"));
  const dbPath = path.join(dir, "notadb.sqlite");
  try {
    // The shape an operator actually hits: a truncated download, a text file, or an
    // encrypted/compressed backup restored to the wrong path.
    writeFileSync(dbPath, "this is not a database, it is a restored-to-the-wrong-path text file\n".repeat(400));
    const after = boot(dbPath);
    assert.equal(after.ok, false, "a non-database file must not boot");
    assert.match(after.message, /DB_INTEGRITY_FAILED/, "the same one code covers both damage shapes");
    assert.match(after.stderr, /DB_INTEGRITY_FAILED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Non-vacuity for the two refusals above, and the guard's real contract: an intact
// database is untouched by the check.
test("an intact database boots, and the check leaves no damage behind", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-intact-"));
  const dbPath = path.join(dir, "intact.sqlite");
  try {
    seedHealthyDb(dbPath);
    const again = boot(dbPath);
    assert.ok(again.ok, `an intact database must boot, saw: ${again.message}`);
    assert.doesNotMatch(again.stderr, /DB_INTEGRITY_FAILED/, "and nothing is logged about integrity");

    const db = new Database(dbPath);
    const quick = db.pragma("quick_check(1)") as { quick_check: string }[];
    db.close();
    assert.equal(quick[0].quick_check, "ok", "the file is still sound after two boots");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The check must stay OFF the per-request path: it belongs to the memoized boot
// connection, not to openStore(), which ~18 isolated stores call on every module load.
test("the integrity check runs at boot, not on every connection open", () => {
  const source = readFileSync(fileURLToPath(new URL("../db-path.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(
    source,
    /quick_check|integrity_check/,
    "openStore() must not run an integrity check — ~18 stores open through it, and quick_check is a full page scan"
  );
});

// ── Foreign keys: the audit, pinned ────────────────────────────────────────────
//
// SQLite defaults `foreign_keys=OFF` PER CONNECTION. openStore() turns it ON for every
// connection — but that is only half an answer, because the audit that goes with it is
// the part nobody had written down: TODAY THE SCHEMA DECLARES NO `REFERENCES` CLAUSE AT
// ALL. So the pragma enforces nothing yet; what it buys is that the moment a relation IS
// declared (or migrated in) it is enforced rather than silently ignored — the failure
// mode where a table ships with a REFERENCES clause that never once fired.
//
// Both halves are pinned here so neither can rot silently: the pragma must stay ON and
// must be genuinely in force (proven against a scratch relation, not just read back),
// and the "no FK declared" fact is asserted so DECLARING one becomes a deliberate step
// that trips this test and gets a real per-table test written for it.
const FK_DIR = mkdtempSync(path.join(os.tmpdir(), "kp-fk-"));
process.env.KP_DB_PATH = path.join(FK_DIR, "fk.sqlite");
after(() => rmSync(FK_DIR, { recursive: true, force: true }));
const { openStore } = await import("../db-path.ts");

test("every connection openStore() hands out has foreign_keys ON, and it is in force", () => {
  const db = openStore();
  try {
    assert.deepEqual(db.pragma("foreign_keys"), [{ foreign_keys: 1 }], "the pragma must be ON on every store connection");

    // Read-back is not proof: assert the constraint actually REFUSES an orphan. With
    // foreign_keys=OFF this insert succeeds silently, which is the whole bug.
    db.exec(`CREATE TABLE fk_parent (id TEXT PRIMARY KEY);
             CREATE TABLE fk_child (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES fk_parent(id));`);
    assert.throws(
      () => db.prepare(`INSERT INTO fk_child (id, parent_id) VALUES ('c1', 'no-such-parent')`).run(),
      /FOREIGN KEY constraint failed/,
      "an orphan insert must be refused — if it succeeds, foreign_keys is set but not enforced"
    );
    db.prepare(`INSERT INTO fk_parent (id) VALUES ('p1')`).run();
    db.prepare(`INSERT INTO fk_child (id, parent_id) VALUES ('c1', 'p1')`).run();
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM fk_child`).get() as { n: number }).n, 1, "a legitimate child still lands");
  } finally {
    db.close();
  }
});

test("the schema declares no REFERENCES clause today — enabling enforcement stays a deliberate step", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-fkaudit-"));
  const dbPath = path.join(dir, "audit.sqlite");
  try {
    seedHealthyDb(dbPath);
    const db = new Database(dbPath);
    const declaring = (
      db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL`).all() as { name: string; sql: string }[]
    ).filter((t) => /\bREFERENCES\b/i.test(t.sql));
    const tables = (db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get() as { n: number }).n;
    db.close();
    assert.ok(tables > 20, `fixture setup: expected the full boot schema, saw ${tables} tables`);
    assert.deepEqual(
      declaring.map((t) => t.name),
      [],
      "a table now declares a foreign key. That is a real change: write a per-table test proving the relation is enforced (orphan refused, cascade/restrict behaviour on delete), then update this pin to name it."
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
