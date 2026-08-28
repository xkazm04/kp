// The one-shot fixture seeders must record THAT they ran, not infer it from a row count.
//
// `COUNT(*) > 0` conflates "never seeded" with "seeded, and the operator has since
// legitimately emptied the table" — so a self-hosted recruiter who archived every job got
// the whole ČS demo corpus injected back on the next boot, silently and on a timer.
// seed_marks makes "has this seeder run against this database" an explicit fact.
//
// Driven in child `node` processes, like core-migrations.test.ts and
// db-test-isolation-guard.test.ts: a genuine RE-BOOT is the thing under test, and
// ensureDb() memoizes on globalThis for the life of a process, so re-running the
// initializer in-process would prove something weaker than what a restart does. Every DB
// here is a throwaway temp file; none of them is data/kp.sqlite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import Database from "better-sqlite3";

// Boots core.ts against whatever KP_DB_PATH it is handed and reports the row counts that
// matter. Seeding is left ENABLED (no KP_EMPTY) — the fixtures are the subject here.
const BOOT_CHILD = `
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.NODE_TEST_CONTEXT = "child-v8";
delete process.env.KP_MULTI_WORKSPACE;
delete process.env.KP_EMPTY;

const core = await import(pathToFileURL(path.join(process.cwd(), "app/_lib/db/core.ts")).href);
const db = core.ensureDb();
const n = (t) => db.prepare("SELECT COUNT(*) AS n FROM " + t).get().n;
const marks = db.prepare("SELECT name FROM seed_marks ORDER BY name").all().map((r) => r.name);
console.log("COUNTS " + JSON.stringify({
  jobs: n("jobs"),
  pipeline: n("pipeline_entries"),
  users: n("users"),
  marks,
}));
`;

type Counts = { jobs: number; pipeline: number; users: number; marks: string[] };

function boot(dbPath: string): Counts {
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
      // Same colour pinning as the sibling child-process tests: inherited FORCE_COLOR
      // would wrap stdout in escape codes and silently break the match below.
      env: { ...process.env, KP_DB_PATH: dbPath, NO_COLOR: "1", FORCE_COLOR: "0", KP_EMPTY: "" },
    }
  );
  const m = /COUNTS (\{.*\})/.exec(res.stdout);
  assert.ok(m, `child did not report counts\nstdout=${res.stdout}\nstderr=${res.stderr}`);
  return JSON.parse(m[1]) as Counts;
}

test("an emptied table is not re-seeded on the next boot, and a pre-seed_marks DB is adopted not duplicated", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-seedmarks-"));
  const dbPath = path.join(dir, "seedmarks.sqlite");
  try {
    // ---- Boot 1: a fresh DB seeds, and records a mark per one-shot seeder.
    const first = boot(dbPath);
    assert.ok(first.jobs > 0, "expected the fresh DB to seed jobs — otherwise this test proves nothing");
    assert.ok(first.pipeline > 0, "expected the fresh DB to seed pipeline entries");
    for (const mark of ["jobs", "org-members", "pipeline"]) {
      assert.ok(first.marks.includes(mark), `expected a '${mark}' seed mark, saw ${JSON.stringify(first.marks)}`);
    }

    // ---- The operator empties two seeded tables, as they are entitled to.
    const db = new Database(dbPath);
    db.prepare(`DELETE FROM jobs`).run();
    db.prepare(`DELETE FROM pipeline_entries`).run();
    db.close();

    // ---- Boot 2: the marks hold. This is the bug: before seed_marks, both tables came
    // back full of Česká spořitelna demo data.
    const second = boot(dbPath);
    assert.equal(second.jobs, 0, "an emptied jobs table must stay empty across a reboot");
    assert.equal(second.pipeline, 0, "an emptied pipeline must stay empty across a reboot");

    // ---- Back-compat: a database seeded BEFORE seed_marks existed has rows but no marks.
    // It must adopt the marks rather than re-seed on top of its existing content.
    const db2 = new Database(dbPath);
    db2.prepare(`DELETE FROM seed_marks`).run();
    const usersBefore = (db2.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
    db2.close();
    assert.ok(usersBefore > 0, "expected seeded org members to still be present for the adoption case");

    const third = boot(dbPath);
    assert.equal(third.users, usersBefore, "adoption must not duplicate or re-create seeded members");
    assert.ok(third.marks.includes("org-members"), "a non-empty table must be STAMPED on the first post-change boot");
    // jobs/pipeline were emptied above, so their counts are 0 and adoption cannot stamp
    // them — that is correct: to this boot they are indistinguishable from never-seeded,
    // which is exactly the pre-change behaviour it is meant to reproduce.
    assert.equal(third.jobs > 0, true, "an emptied table with no mark re-seeds once, then marks itself");

    // ---- And from there the mark governs again.
    const db3 = new Database(dbPath);
    db3.prepare(`DELETE FROM jobs`).run();
    db3.close();
    assert.equal(boot(dbPath).jobs, 0, "once marked, an emptied table stays empty");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
