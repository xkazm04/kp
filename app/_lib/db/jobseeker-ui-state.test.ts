// The seeker's cross-device UI state on an isolated DB: the design is one row that a
// save replaces, a cover note is one row per posting, text is capped, and past
// COVER_NOTES_KEPT the least recently written notes go.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  countCoverNotes,
  deleteGithubState,
  getCoverNote,
  getCvDesignState,
  getGithubState,
  getRoleResearch,
  ROLE_RESEARCH_KEPT,
  setCoverNote,
  setCvDesignState,
  setGithubState,
  setRoleResearch,
  UI_STATE_KINDS,
} from "./jobseeker-ui-state.ts";
import { ensureDb, JOBSEEKER_UI_STATE_KINDS_SQL } from "./core.ts";
import { COVER_NOTE_MAX_CHARS, COVER_NOTES_KEPT } from "../jobseeker/types.ts";

after(() => cleanupUnitDb());

test("the design is one row per profile; a save replaces it", () => {
  assert.equal(getCvDesignState("p-design"), null);
  setCvDesignState("p-design", { template: "editorial", accent: "moss" });
  setCvDesignState("p-design", { template: "compact", accent: "plum", tailor: 1 });
  const got = getCvDesignState("p-design");
  assert.deepEqual(got?.value, { template: "compact", accent: "plum", tailor: 1 });
  assert.match(got!.updatedAt, /^\d{4}-\d\d-\d\dT/);
  assert.equal(getCvDesignState("p-other"), null, "another profile has its own");
});

test("a cover note is kept per posting, replaced by a later save, and capped", () => {
  setCoverNote("p-cover", "post-a", "First draft");
  setCoverNote("p-cover", "post-b", "Other posting");
  setCoverNote("p-cover", "post-a", "Second draft");
  assert.equal(getCoverNote("p-cover", "post-a")?.value, "Second draft");
  assert.equal(getCoverNote("p-cover", "post-b")?.value, "Other posting");
  assert.equal(getCoverNote("p-cover", "post-c"), null);
  setCoverNote("p-cover", "post-long", "x".repeat(COVER_NOTE_MAX_CHARS + 50));
  assert.equal(getCoverNote("p-cover", "post-long")?.value.length, COVER_NOTE_MAX_CHARS);
  // An emptied note is a real edit ("I cleared it"), not an absence.
  setCoverNote("p-cover", "post-b", "");
  assert.equal(getCoverNote("p-cover", "post-b")?.value, "");
});

test("past COVER_NOTES_KEPT notes the least recently written go, the newest stay", () => {
  for (let i = 0; i < COVER_NOTES_KEPT + 5; i++) setCoverNote("p-bound", `post-${String(i).padStart(4, "0")}`, `note ${i}`);
  assert.equal(countCoverNotes("p-bound"), COVER_NOTES_KEPT);
  assert.equal(getCoverNote("p-bound", `post-${String(COVER_NOTES_KEPT + 4).padStart(4, "0")}`)?.value, `note ${COVER_NOTES_KEPT + 4}`);
  assert.equal(getCoverNote("p-bound", "post-0000"), null, "the oldest was dropped");
});

test("the TS kinds are exactly the table's CHECK", () => {
  assert.equal(UI_STATE_KINDS.map((k) => `'${k}'`).join(","), JOBSEEKER_UI_STATE_KINDS_SQL);
});

test("a research result is kept per key, replaced by a later save, and bounded", () => {
  assert.equal(getRoleResearch("p-res", "k-a"), null);
  setRoleResearch("p-res", "k-a", { titles: ["AI Engineer"], n: 1 });
  setRoleResearch("p-res", "k-a", { titles: ["AI Engineer"], n: 2 });
  assert.deepEqual(getRoleResearch("p-res", "k-a")?.value, { titles: ["AI Engineer"], n: 2 });
  for (let i = 0; i < ROLE_RESEARCH_KEPT + 3; i++) setRoleResearch("p-res-bound", `k-${String(i).padStart(3, "0")}`, { i });
  const kept = ensureDb()
    .prepare(`SELECT COUNT(*) AS n FROM jobseeker_ui_state WHERE workspace_id = ? AND profile_id = ? AND kind = 'role_research'`)
    .get("workspace", "p-res-bound") as { n: number };
  assert.equal(kept.n, ROLE_RESEARCH_KEPT);
  assert.equal(getRoleResearch("p-res-bound", "k-000"), null, "the oldest went");
  assert.deepEqual(getRoleResearch("p-res-bound", `k-${String(ROLE_RESEARCH_KEPT + 2).padStart(3, "0")}`)?.value, { i: ROLE_RESEARCH_KEPT + 2 });
});

test("the GitHub state is one row per profile; a save replaces it and delete forgets it", () => {
  assert.equal(getGithubState("p-gh"), null);
  setGithubState("p-gh", { handle: "octocat", confirmed: false });
  setGithubState("p-gh", { handle: "octocat", confirmed: true });
  assert.deepEqual(getGithubState("p-gh")?.value, { handle: "octocat", confirmed: true });
  assert.equal(getGithubState("p-gh-other"), null);
  assert.equal(deleteGithubState("p-gh"), true);
  assert.equal(getGithubState("p-gh"), null);
  assert.equal(deleteGithubState("p-gh"), false, "nothing left to forget");
});

test("the live table's CHECK takes every kind (a fresh database, or one widened at boot)", () => {
  const sql = (ensureDb().prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jobseeker_ui_state'`).get() as { sql: string }).sql;
  for (const kind of UI_STATE_KINDS) assert.ok(sql.includes(`'${kind}'`), `the table's CHECK names ${kind}`);
});
