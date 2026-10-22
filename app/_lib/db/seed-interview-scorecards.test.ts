// The demo corpus' completed interviews (seed-interview-scorecards.ts): they exist on a
// fresh boot, they give the scorecard arm of kpi:reasons both a hit and a MISS, and a
// deleted session is not put back on the next boot (seed_marks, never a row count).
// Driven in child `node` processes like core-seed-marks.test.ts: a genuine re-boot is
// the subject, and ensureDb() memoizes per process. Throwaway temp DBs only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { countReasonsCoverage } from "../reasons-coverage.ts";

const BOOT_CHILD = `
import path from "node:path";
import { pathToFileURL } from "node:url";
process.env.NODE_TEST_CONTEXT = "child-v8";
delete process.env.KP_MULTI_WORKSPACE;
const core = await import(pathToFileURL(path.join(process.cwd(), "app/_lib/db/core.ts")).href);
core.ensureDb();
console.log("BOOTED");
`;

function boot(dbPath: string): void {
  const res = spawnSync(
    process.execPath,
    ["--import", "./scripts/test-alias-loader.mjs", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", BOOT_CHILD],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, KP_DB_PATH: dbPath, NO_COLOR: "1", FORCE_COLOR: "0", KP_EMPTY: "", KP_SEED_DEMO: "1" } }
  );
  assert.match(res.stdout, /BOOTED/, `boot failed\nstdout=${res.stdout}\nstderr=${res.stderr}`);
}

test("a fresh boot seeds completed scorecards (one all-Not-assessed), and a deleted session stays deleted", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kp-seedsc-"));
  const dbPath = path.join(dir, "sc.sqlite");
  try {
    boot(dbPath);
    const db = new Database(dbPath);
    const rows = db
      .prepare(`SELECT id, entry_id, scorecard_json, workspace_id FROM interview_sessions WHERE status = 'completed' AND mode = 'candidate'`)
      .all() as { id: string; entry_id: string; scorecard_json: string; workspace_id: string }[];
    assert.equal(rows.length, 4);
    for (const r of rows) {
      const entry = db.prepare(`SELECT id FROM pipeline_entries WHERE id = ?`).get(r.entry_id);
      assert.ok(entry, `${r.id} is attached to a real seeded entry`);
      assert.equal(r.workspace_id, "workspace");
    }
    assert.ok(db.prepare(`SELECT 1 FROM seed_marks WHERE name = 'interview-scorecards'`).get(), "the seeder recorded that it ran");

    // The arm is measured with a real denominator, and the corpus carries its own miss.
    const verdicts = rows.map((r) => ({ kind: "scorecard" as const, id: r.id, ratings: JSON.parse(r.scorecard_json).ratings }));
    const noCatalog = Object.assign(() => "", { has: () => false }) as never;
    const cov = countReasonsCoverage(verdicts, noCatalog);
    assert.equal(cov.byKind.scorecard.checked, 4);
    assert.equal(cov.byKind.scorecard.withReasons, 3);
    assert.equal(cov.misses.length, 1);

    db.prepare(`DELETE FROM interview_sessions`).run();
    db.close();
    boot(dbPath);
    const db2 = new Database(dbPath, { readonly: true });
    assert.equal((db2.prepare(`SELECT COUNT(*) AS n FROM interview_sessions`).get() as { n: number }).n, 0, "marked, so not re-seeded");
    db2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
