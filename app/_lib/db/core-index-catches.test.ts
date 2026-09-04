// Boot-time index creation says what it swallows.
//
// core.ts's loud `migrateExec` is the law's own example of a catch that tolerates ONLY
// the benign "already applied" error — but one layer below it two shapes still swallowed
// everything:
//
//   1. ONE bare `catch { /* index already exists */ }` wrapped NINE `CREATE INDEX IF NOT
//      EXISTS` statements. `IF NOT EXISTS` means "already exists" can never be raised
//      there, so the comment named an impossible error while the catch quietly absorbed
//      the possible ones (lock contention, I/O, a name collision with a real table) AND —
//      because one try wrapped all nine — aborted every remaining index in the block. A
//      tenant-scoped read then ran a full table scan forever, with nothing logged.
//   2. FOUR `catch {}` around unique-index creation, all meaning "a legacy DB may hold
//      duplicate rows that block this index". That is a real, tolerable case — but the
//      catch could not tell it from a locked or corrupt database, and said nothing either
//      way, so an operator whose DB genuinely holds impossible duplicates learned nothing.
//
// Both now go through a migrator that names what it tolerates: the plain indexes through
// `migrateExec`, the unique ones through a helper that tolerates SQLITE_CONSTRAINT_UNIQUE
// (with a warn line naming the index) and re-throws everything else.
//
// Driven in child `node` processes like core-integrity.test.ts: a genuine BOOT is the
// subject and ensureDb() memoizes on globalThis for the life of a process. Every DB here
// is a throwaway temp file under this file's own private root; none of them is
// data/kp.sqlite. The root is deliberately NOT removed in an after() hook — the isolated
// stores hold handles Windows will not let us unlink, and a failed run's file is evidence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import Database from "better-sqlite3";

const ROOT = mkdtempSync(path.join(os.tmpdir(), "kp-index-catches-"));

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

function boot(dbPath: string): Boot {
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
      env: { ...process.env, KP_DB_PATH: dbPath, NO_COLOR: "1", FORCE_COLOR: "0", KP_EMPTY: "1" },
    }
  );
  const m = /BOOT (ok|refused)(.*)/.exec(res.stdout);
  assert.ok(m, `child reported no boot verdict\nstdout=${res.stdout}\nstderr=${res.stderr}`);
  return { ok: m[1] === "ok", message: m[2].trim(), stderr: res.stderr };
}

function fresh(name: string): string {
  return path.join(mkdtempSync(path.join(ROOT, `${name}-`)), "kp.sqlite");
}

// ---- 1. The nine tenancy indexes: an unexpected failure is LOUD ---------------------
//
// Injection shape: a database that already holds a TABLE under one of the index names.
// SQLite answers `CREATE INDEX IF NOT EXISTS idx_jds_workspace …` with SQLITE_ERROR
// "there is already a table named idx_jds_workspace" — an error `IF NOT EXISTS` does not
// absorb and `migrateExec`'s benign-error test does not match. It stands in for every
// real unexpected failure of that block (lock, I/O, corruption), all of which the old
// bare catch treated as "index already exists".
test("an unexpected failure creating a tenancy index refuses the boot instead of skipping the rest", () => {
  const dbPath = fresh("collide");
  const planted = new Database(dbPath);
  planted.exec(`CREATE TABLE idx_jds_workspace (why TEXT)`);
  planted.close();

  const result = boot(dbPath);
  assert.equal(result.ok, false, "a database whose index name is taken by a table must not boot silently");
  assert.match(
    result.message,
    /idx_jds_workspace/,
    "the refusal names the object that failed, so an operator can act on it"
  );
  assert.match(result.stderr, /db:migrate/, "and it is logged with the migrator's tag, not only thrown");
});

// Non-vacuity: the same boot, without the planted collision, creates all nine indexes.
// If it did not, "refuses the boot" above could pass against a seam that refuses always,
// and the abort-the-rest half of the defect would be untestable.
test("a clean boot creates every tenancy index in the block", () => {
  const dbPath = fresh("clean");
  const result = boot(dbPath);
  assert.ok(result.ok, `a clean database must boot, saw: ${result.message}`);

  const db = new Database(dbPath, { readonly: true });
  const names = new Set(
    (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]).map((r) => r.name)
  );
  db.close();
  for (const index of [
    "idx_analyses_workspace",
    "idx_profiles_workspace",
    "idx_jds_workspace",
    "idx_jd_revisions_workspace",
    "idx_jobs_workspace",
    "idx_pipeline_events_workspace",
    "idx_consent_events_workspace",
    "idx_channel_webhooks_workspace",
    "idx_dev_outbox_workspace",
  ]) {
    assert.ok(names.has(index), `${index} must exist after a clean boot`);
  }
});

// ---- 2. The unique indexes: duplicates are tolerated, and SAID ----------------------
//
// The tolerable case, reproduced exactly as it reaches a real deployment: a DB that once
// booted without the index (or had it dropped) and accumulated duplicate submission
// triples. Boot must survive — the app-level coalescing is still the guarantee — but it
// must no longer be silent about a DB holding rows the app believes impossible.
test("pre-existing duplicates leave the unique index off, boot alive, and the reason logged", () => {
  const dbPath = fresh("dupes");
  assert.ok(boot(dbPath).ok, "fixture setup: a fresh DB must boot");

  const db = new Database(dbPath);
  db.exec(`DROP INDEX IF EXISTS idx_dev_submissions_dedup`);
  const insert = db.prepare(
    `INSERT INTO dev_submissions (id, posting_id, candidate_ref, repo_ref, received_at) VALUES (?, 'p-1', 'c-1', 'r-1', '2024-01-01T00:00:00.000Z')`
  );
  insert.run("sub-dupe-a");
  insert.run("sub-dupe-b");
  db.close();

  const result = boot(dbPath);
  assert.ok(result.ok, `a DB with legacy duplicates must still boot, saw: ${result.message}`);
  assert.match(
    result.stderr,
    /idx_dev_submissions_dedup/,
    "the skipped index is named in the log — a silent skip is how the duplicate rows stayed invisible"
  );

  const after = new Database(dbPath, { readonly: true });
  const index = after
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_dev_submissions_dedup'`)
    .get();
  const rows = after.prepare(`SELECT COUNT(*) AS n FROM dev_submissions WHERE posting_id = 'p-1'`).get() as {
    n: number;
  };
  after.close();
  assert.equal(index, undefined, "the index stays off — the duplicate rows are the operator's to resolve");
  assert.equal(rows.n, 2, "and neither duplicate row was dropped to force the index through");
});

// The other half of the same contract: a failure that is NOT a duplicate-row constraint
// must not hide behind the duplicates comment. Same collision injection as the tenancy
// block, aimed at the unique index this time.
test("a non-duplicate failure creating a unique index refuses the boot", () => {
  const dbPath = fresh("uq-collide");
  const planted = new Database(dbPath);
  planted.exec(`CREATE TABLE idx_dev_submissions_dedup (why TEXT)`);
  planted.close();

  const result = boot(dbPath);
  assert.equal(result.ok, false, "a name collision is not a duplicate-row problem and must not be swallowed");
  assert.match(result.message, /idx_dev_submissions_dedup/, "the refusal names the index");
});
