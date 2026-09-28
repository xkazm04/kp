// The kind CHECK widening on a database from before role_research / github existed: the
// table is written in its OLD shape, with rows, before any store opens the file; the first
// ensureDb() then rebuilds it once (core.ts, rebuildTable), keeping every row and the index.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens),
// and the stores are imported only AFTER the old table exists.
import { cleanupUnitDb, UNIT_DB_PATH } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

after(() => cleanupUnitDb());

test("a database from before the new kinds is widened once, its rows and index kept", async () => {
  const old = new Database(UNIT_DB_PATH!);
  old.exec(`
    CREATE TABLE jobseeker_ui_state (
      workspace_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('cv_design','cover_note')),
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, profile_id, kind, key)
    );
    CREATE INDEX idx_jobseeker_ui_state_recent ON jobseeker_ui_state (workspace_id, profile_id, kind, updated_at DESC);
    INSERT INTO jobseeker_ui_state VALUES ('workspace', 'p-old', 'cv_design', '', '{"template":"folio"}', '2026-09-01T10:00:00.000Z');
    INSERT INTO jobseeker_ui_state VALUES ('workspace', 'p-old', 'cover_note', 'post-1', '"Dear team"', '2026-09-02T10:00:00.000Z');
  `);
  assert.throws(() => old.prepare(`INSERT INTO jobseeker_ui_state VALUES ('workspace', 'p-old', 'github', '', '{}', 'x')`).run(), /CHECK/i);
  old.close();

  const { ensureDb } = await import("./core.ts");
  const store = await import("./jobseeker-ui-state.ts");
  const db = ensureDb();

  assert.deepEqual(store.getCvDesignState("p-old")?.value, { template: "folio" }, "the old design row survived");
  assert.equal(store.getCoverNote("p-old", "post-1")?.value, "Dear team", "the old cover note survived");
  store.setGithubState("p-old", { handle: "octocat" });
  assert.deepEqual(store.getGithubState("p-old")?.value, { handle: "octocat" }, "the new kind is accepted");
  store.setRoleResearch("p-old", "k", { titles: ["AI Engineer"] });
  assert.deepEqual(store.getRoleResearch("p-old", "k")?.value, { titles: ["AI Engineer"] });

  const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'jobseeker_ui_state'`).all() as { name: string }[];
  assert.ok(indexes.some((i) => i.name === "idx_jobseeker_ui_state_recent"), "the recency index was restored");
  const scratch = db.prepare(`SELECT name FROM sqlite_master WHERE name = 'jobseeker_ui_state_new'`).get();
  assert.equal(scratch, undefined, "no scratch table is left behind");
});
