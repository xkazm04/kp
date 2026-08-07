// Import the REAL native better-sqlite3 first (never a shim), so every store call
// below opens a genuine on-disk SQLite file.
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file at
// module-eval time and must run BEFORE any module that transitively touches db-path
// (devcase → core → db-path). Keep it above the app-module imports.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { saveDevCase, getDevCase, createPosting, setPostingStatus } from "./devcase.ts";

// PUBLISH DEDUP (bug-ui-scan-2026-07-09 (dev-case-authoring-publishing #4)). Publishing
// a case must be idempotent per (workspace, case, channel) while a posting stays OPEN:
// a concurrent / multi-tab / reload re-publish used to mint a SECOND live apply token
// for one case, splitting submissions across two tokens so the case-wide shortlist
// fragmented and the "true #1" ranking was wrong. createPosting now reuses the existing
// OPEN posting (its token) instead of inserting a duplicate; a CLOSED posting is
// excluded so a deliberate re-publish after closing still mints a fresh one.
//
// Real DB (the store's own connection on a throwaway file). Full ensureDb() init runs
// on the first store call in before().

/** A fresh approved dev case with no postings yet. */
function freshCase(title: string): string {
  return saveDevCase({
    need: { title },
    analysis: {},
    role: { title: `${title} role` },
    case: { title: `${title} case` },
  }).id;
}

before(() => {
  // Force the full ensureDb() init (creates dev_cases / dev_postings + the dedup index).
  getDevCase("__init__");
});

after(() => cleanupUnitDb());

test("re-publishing an OPEN case+channel reuses the same posting + token (no duplicate)", () => {
  const caseId = freshCase("dedup");

  const first = createPosting({ caseId, channel: "local", token: "tok-dedup-1", roleTitle: "r", caseTitle: "c" });
  // A second publish (a double-click, a multi-tab reload, a concurrent recruiter) with a
  // DIFFERENT freshly-minted token must NOT create a second posting.
  const second = createPosting({ caseId, channel: "local", token: "tok-dedup-2", roleTitle: "r", caseTitle: "c" });

  // NON-VACUITY: pre-fix createPosting always INSERTed a new row with a new id + the
  // passed token, so `second.id !== first.id` and `second.token === "tok-dedup-2"` —
  // both assertions below would fail against that behavior.
  assert.equal(second.id, first.id, "the same posting is reused, not a duplicate");
  assert.equal(second.token, first.token, "the ORIGINAL live token is reused, not the new one");
  assert.equal(second.token, "tok-dedup-1", "the reused token is the first one minted");
});

test("a DIFFERENT channel for the same case mints its own posting", () => {
  const caseId = freshCase("dedup-channels");
  const local = createPosting({ caseId, channel: "local", token: "tok-ch-local", roleTitle: "r", caseTitle: "c" });
  const link = createPosting({ caseId, channel: "link", token: "tok-ch-link", roleTitle: "r", caseTitle: "c" });
  // Dedup is scoped to (workspace, case, CHANNEL): two channels are two live surfaces.
  assert.notEqual(link.id, local.id, "distinct channels are distinct postings");
  assert.equal(link.token, "tok-ch-link");
});

test("re-publishing after the posting is CLOSED mints a fresh posting", () => {
  const caseId = freshCase("dedup-reopen");
  const first = createPosting({ caseId, channel: "local", token: "tok-reopen-1", roleTitle: "r", caseTitle: "c" });
  assert.equal(setPostingStatus(first.id, "closed"), true);

  // The old posting is closed → outside the open-dedup guard → a deliberate re-publish
  // is allowed to open a NEW posting with a NEW token.
  const second = createPosting({ caseId, channel: "local", token: "tok-reopen-2", roleTitle: "r", caseTitle: "c" });
  assert.notEqual(second.id, first.id, "a closed posting does not block a fresh publish");
  assert.equal(second.token, "tok-reopen-2", "the fresh posting carries its own new token");
});
