import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { seedBenchmarkTeam, benchmarkDemoSeedEnabled } from "./seed-benchmark-team.ts";

// bug-ui-scan-2026-07-09 (data-store-persistence #2): the benchmark team is DEMO fixture
// data that lives under the real org (org-default) and is the ONLY data the cross-team
// org benchmark reads — so seeding it in production contaminated a real tenant's org-wide
// hire rates and faked the k-anon floor. It must seed ONLY in non-production / on opt-in.

// A throwaway in-memory DB with just the two tables the seeder touches — no ensureDb, so
// this proves the gate directly rather than observing the (already-seeded) shared test DB.
function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT, org_id TEXT, type TEXT, created_at TEXT);
    CREATE TABLE pipeline_entries (
      id TEXT PRIMARY KEY, candidate_id TEXT, candidate_label TEXT, job_id TEXT, job_title TEXT,
      stage TEXT, status TEXT, created_at TEXT, stage_changed_at TEXT, updated_at TEXT, workspace_id TEXT
    );
  `);
  return db;
}

function count(db: Database.Database): { teams: number; entries: number } {
  return {
    teams: (db.prepare(`SELECT COUNT(*) AS n FROM workspaces WHERE id = 'ws-benchmark-north'`).get() as { n: number }).n,
    entries: (db.prepare(`SELECT COUNT(*) AS n FROM pipeline_entries WHERE workspace_id = 'ws-benchmark-north'`).get() as { n: number }).n,
  };
}

test("benchmarkDemoSeedEnabled: on in dev, off in production, on with an explicit opt-in", () => {
  assert.equal(benchmarkDemoSeedEnabled({ NODE_ENV: "development" }), true);
  assert.equal(benchmarkDemoSeedEnabled({}), true, "default (unset NODE_ENV, e.g. tests) seeds");
  assert.equal(benchmarkDemoSeedEnabled({ NODE_ENV: "production" }), false, "never in production by default");
  for (const v of ["1", "true", "yes", "on"]) {
    assert.equal(benchmarkDemoSeedEnabled({ NODE_ENV: "production", KP_SEED_DEMO: v }), true, `KP_SEED_DEMO=${v} opts in`);
  }
  assert.equal(benchmarkDemoSeedEnabled({ NODE_ENV: "production", KP_SEED_DEMO: "0" }), false);
});

test("seedBenchmarkTeam is a NO-OP in production (no synthetic team contaminates the org benchmark) (#2)", () => {
  const db = freshDb();
  seedBenchmarkTeam(db, { NODE_ENV: "production" });
  const c = count(db);
  assert.equal(c.teams, 0, "production must not create the benchmark team");
  assert.equal(c.entries, 0, "production must not insert the 24 fabricated entries");
});

test("seedBenchmarkTeam DOES seed the 24 demo entries in dev / on opt-in (non-vacuous) (#2)", () => {
  const dev = freshDb();
  seedBenchmarkTeam(dev, { NODE_ENV: "development" });
  assert.equal(count(dev).teams, 1, "dev seeds the demo team");
  assert.equal(count(dev).entries, 24, "dev seeds all 24 reference entries");

  const optIn = freshDb();
  seedBenchmarkTeam(optIn, { NODE_ENV: "production", KP_SEED_DEMO: "1" });
  assert.equal(count(optIn).entries, 24, "KP_SEED_DEMO forces the seed even in production");

  // Idempotent: a second call adds nothing (keyed off the team's own emptiness).
  seedBenchmarkTeam(dev, { NODE_ENV: "development" });
  assert.equal(count(dev).entries, 24, "re-seeding is idempotent");
});
