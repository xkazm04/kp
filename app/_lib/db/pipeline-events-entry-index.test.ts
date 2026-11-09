// pipeline_events(entry_id) must be indexed.
//
// The score-provenance lookup (`scoredAtByEntryIds`, app/_lib/db/pipeline.ts) runs on
// the board's 30-second poll and filters `pipeline_events` by `entry_id IN (...)`. The
// table carried created_at / workspace indexes only, so the lookup read every event the
// tenant ever wrote. `idx_pipeline_events_entry` is the additive fix (core.ts).
//
// Two claims: the index exists after boot on a fresh database AND on an older one that
// lacks it (the same CREATE ... IF NOT EXISTS runs on every boot), and EXPLAIN QUERY
// PLAN for the REAL lookup statement seeks it. unit-db.ts must stay the first project
// import (isolated throwaway DB for the in-process half).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import Database from "better-sqlite3";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { removeTempDirs } from "../testing/tmp-cleanup.ts";
import { ensureDb } from "./core.ts";
import { scoredAtSql } from "./pipeline.ts";

const ROOT = mkdtempSync(path.join(os.tmpdir(), "kp-events-entry-index-"));
after(() => {
  cleanupUnitDb();
  removeTempDirs(ROOT);
});

const BOOT_CHILD = `
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.NODE_TEST_CONTEXT = "child-v8";
delete process.env.KP_MULTI_WORKSPACE;

const core = await import(pathToFileURL(path.join(process.cwd(), "app/_lib/db/core.ts")).href);
core.ensureDb();
console.log("BOOT ok");
`;

function boot(dbPath: string): void {
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
      env: { ...process.env, KP_DB_PATH: dbPath, NO_COLOR: "1", FORCE_COLOR: "0", KP_EMPTY: "1" },
    }
  );
  assert.match(res.stdout, /BOOT ok/, `boot failed\nstdout=${res.stdout}\nstderr=${res.stderr}`);
}

function entryIndexColumns(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (db.prepare(`PRAGMA index_info(idx_pipeline_events_entry)`).all() as { name: string }[]).map((r) => r.name);
  } finally {
    db.close();
  }
}

test("a fresh database boots with idx_pipeline_events_entry on entry_id", () => {
  const dbPath = path.join(mkdtempSync(path.join(ROOT, "fresh-")), "kp.sqlite");
  boot(dbPath);
  assert.deepEqual(entryIndexColumns(dbPath), ["entry_id"]);
});

test("an older database without the index gains it on the next boot, data untouched", () => {
  const dbPath = path.join(mkdtempSync(path.join(ROOT, "older-")), "kp.sqlite");
  boot(dbPath);

  const old = new Database(dbPath);
  old.exec(`DROP INDEX idx_pipeline_events_entry`);
  old
    .prepare(`INSERT INTO pipeline_events (entry_id, kind, created_at, workspace_id) VALUES ('e1', 'scored', '2026-01-01T00:00:00Z', 'workspace')`)
    .run();
  old.close();
  assert.deepEqual(entryIndexColumns(dbPath), [], "precondition: the index is gone");

  boot(dbPath);
  assert.deepEqual(entryIndexColumns(dbPath), ["entry_id"]);
  const db = new Database(dbPath, { readonly: true });
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM pipeline_events WHERE entry_id = 'e1'`).get() as { n: number }).n;
  db.close();
  assert.equal(n, 1, "the migration rewrote no data");
});

test("the score-provenance lookup seeks idx_pipeline_events_entry", () => {
  const sql = scoredAtSql(3);
  const params = new Array((sql.match(/\?/g) ?? []).length).fill("x");
  const detail = (ensureDb().prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[])
    .map((r) => r.detail)
    .join(" | ");
  assert.match(detail, /idx_pipeline_events_entry/, `planner chose: ${detail}`);
  assert.match(detail, /SEARCH/, `planner chose: ${detail}`);
});
