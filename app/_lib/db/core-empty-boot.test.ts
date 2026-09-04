// KP_EMPTY=1 boots a genuinely BLANK tenant — and the default boot does not.
//
// `npm run dev:empty` exists so first-run onboarding can be verified against a tenant that
// looks like a real fresh install, and the gate for it is one `if (fixtureSeedEnabled())`
// wrapping every seeder in core.ts. `grep KP_EMPTY app/_lib/db/*.test.ts` returned nothing:
// several suites SET the flag to keep the demo corpus out of their assertions, but nothing
// asserted what it does. So a seeder added outside the gate — the ordinary way this
// regresses, since a new seeder is a new line in a long block — would quietly re-seed the
// "empty" DB, and the onboarding wizard would be verified against a tenant that already had
// jobs and candidates in it.
//
// The contract has two halves and both are pinned here, because either alone is vacuous:
//   - KP_EMPTY=1: no fixture CONTENT at all, and onboarding_state stays NULL so the wizard
//     fires.
//   - KP_EMPTY unset: the corpus IS seeded, and onboarding_state is 'completed' so the
//     wizard does not ambush an established demo DB.
// The STRUCTURAL bootstrap (schema, the default workspace, the default org) runs in BOTH:
// a real deployment has those too, and an empty tenant with no workspace row is not a
// blank install, it is a broken one.
//
// Child `node` processes: a genuine boot is the subject and ensureDb() memoizes for the
// life of a process, so one boot per verdict. Throwaway files under this file's own
// private root, deliberately NOT removed in an after() hook.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import Database from "better-sqlite3";

const ROOT = mkdtempSync(path.join(os.tmpdir(), "kp-empty-boot-"));

const BOOT_CHILD = `
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.NODE_TEST_CONTEXT = "child-v8";
delete process.env.KP_MULTI_WORKSPACE;

const core = await import(pathToFileURL(path.join(process.cwd(), "app/_lib/db/core.ts")).href);
core.ensureDb();
console.log("BOOT ok");
`;

/** Boot a fresh throwaway DB with the given KP_EMPTY value and hand back a read-only handle. */
function bootFresh(name: string, kpEmpty: string): Database.Database {
  const dbPath = path.join(mkdtempSync(path.join(ROOT, `${name}-`)), "kp.sqlite");
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
      env: { ...process.env, KP_DB_PATH: dbPath, NO_COLOR: "1", FORCE_COLOR: "0", KP_EMPTY: kpEmpty },
    }
  );
  assert.match(res.stdout, /BOOT ok/, `boot failed\nstdout=${res.stdout}\nstderr=${res.stderr}`);
  return new Database(dbPath, { readonly: true });
}

function count(db: Database.Database, sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}

test("KP_EMPTY=1 boots a blank tenant: schema and the default workspace, no fixture content", () => {
  const db = bootFresh("empty", "1");
  try {
    // Structural bootstrap — present in a real deployment, so present here.
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM workspaces WHERE id = 'workspace'`), 1, "the default workspace exists");
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM organizations WHERE id = 'org-default'`), 1, "the default org exists");
    assert.ok(
      count(db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`) > 20,
      "the full schema is created — an empty tenant is not a schema-less one"
    );

    // Fixture content — none of it.
    for (const table of ["jds", "jobs", "analyses", "profiles", "pipeline_entries", "pipeline_events", "users"]) {
      assert.equal(count(db, `SELECT COUNT(*) AS n FROM ${table}`), 0, `${table} must be empty under KP_EMPTY=1`);
    }
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM seed_marks`), 0, "no seeder recorded a run");

    // The point of the whole flag: the first-run wizard must fire.
    const state = db.prepare(`SELECT onboarding_state AS v FROM workspaces WHERE id = 'workspace'`).get() as {
      v: string | null;
    };
    assert.equal(state.v, null, "onboarding_state stays NULL so the first-run wizard fires");
  } finally {
    db.close();
  }
});

// Non-vacuity for every assertion above: without the flag the SAME boot seeds the corpus.
// Without this, "no fixture content" would pass against a seeder block that had been
// deleted outright.
test("the default boot (KP_EMPTY unset) seeds the demo corpus and marks the tenant onboarded", () => {
  const db = bootFresh("seeded", "");
  try {
    assert.ok(count(db, `SELECT COUNT(*) AS n FROM jds`) > 0, "the example JD is seeded by default");
    assert.ok(count(db, `SELECT COUNT(*) AS n FROM jobs`) > 0, "the job corpus is seeded by default");
    assert.ok(count(db, `SELECT COUNT(*) AS n FROM pipeline_entries`) > 0, "the demo board is seeded by default");
    assert.ok(count(db, `SELECT COUNT(*) AS n FROM users WHERE org_id = 'org-default'`) > 0, "the org roster is seeded");
    assert.ok(count(db, `SELECT COUNT(*) AS n FROM seed_marks`) > 0, "and each seeder RECORDED that it ran");

    const state = db.prepare(`SELECT onboarding_state AS v FROM workspaces WHERE id = 'workspace'`).get() as {
      v: string | null;
    };
    assert.equal(state.v, "completed", "a fixture-seeded tenant is an established demo, not a first run");
  } finally {
    db.close();
  }
});
