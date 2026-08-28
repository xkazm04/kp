// Import the REAL native better-sqlite3 first (never a shim), so every store call
// below opens a genuine on-disk SQLite file.
import "better-sqlite3";
import { test, after } from "node:test";
import assert from "node:assert/strict";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file at
// module-eval time and must run BEFORE any module that transitively touches db-path.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { candidateIdByContact, createPipelineEntry, getPipelineEntry, listPipeline } from "./pipeline.ts";
import { devCaseIdForEntry, submissionIdForEntry } from "../devcase-identity.ts";
import { DEFAULT_WORKSPACE_ID } from "./workspaces.ts";

// ONE THREAD (assignment → board). `dev_case_id` / `dev_submission_id` are what let a
// pipeline entry hold the REAL job and the REAL candidate while still knowing which
// assignment produced it — the two facts that used to have to share one id field, and
// therefore could not both be true. These pin the storage half: that the columns
// round-trip on both read paths, that a re-add BACKFILLS them onto an entry that
// already existed (the merge that stops one person being two rows), and that it can
// never overwrite a link already on file.

after(() => cleanupUnitDb());

const WS = "team-one-thread";

test("the assignment links round-trip on the point read AND the board list", () => {
  const { entry, created } = createPipelineEntry({
    candidateId: "profile-linked",
    candidateLabel: "Linked Lena",
    jobId: "jd-backend-eng",
    jobTitle: "Backend Engineer",
    devCaseId: "dc_alpha",
    devSubmissionId: "sub_alpha",
    workspaceId: WS,
  });
  assert.equal(created, true);
  assert.equal(entry.devCaseId, "dc_alpha");
  assert.equal(entry.devSubmissionId, "sub_alpha");

  // The point read (SELECT *) and the board read (an EXPLICIT column list) are
  // different statements; the board one is the path the interview brief is resolved
  // from, and an omitted column there reads as "not from an assignment" with no error.
  assert.equal(getPipelineEntry(entry.id, WS)?.devCaseId, "dc_alpha");
  const onBoard = listPipeline(WS).find((e) => e.id === entry.id);
  assert.ok(onBoard, "the entry is on its team's board");
  assert.equal(onBoard.devCaseId, "dc_alpha", "…and the board payload carries the link");
  assert.equal(onBoard.devSubmissionId, "sub_alpha");

  // The resolvers read the columns, not the ids — neither id hints at a dev case.
  assert.equal(devCaseIdForEntry(onBoard), "dc_alpha");
  assert.equal(submissionIdForEntry(onBoard), "sub_alpha");
});

test("an ordinary entry carries no links, and resolves to no assignment", () => {
  const { entry } = createPipelineEntry({
    candidateId: "profile-ordinary",
    candidateLabel: "Ordinary Ola",
    jobId: "jd-marketing",
    jobTitle: "Marketing",
    workspaceId: WS,
  });
  assert.equal(entry.devCaseId, null);
  assert.equal(entry.devSubmissionId, null);
  assert.equal(devCaseIdForEntry(entry), null);
  assert.equal(submissionIdForEntry(entry), null);
});

test("a promote onto an entry that already exists BACKFILLS the links instead of duplicating the person", () => {
  // The exact shape the milestone is about: the candidate applied to the JD's own
  // opening first (no assignment), then did the work sample. Same (candidate, job)
  // pair ⇒ same entry id ⇒ one row, now carrying the assignment.
  const applied = createPipelineEntry({
    candidateId: "profile-twice",
    candidateLabel: "Twice Tereza",
    jobId: "jd-backend-eng",
    jobTitle: "Backend Engineer",
    workspaceId: WS,
  });
  assert.equal(applied.created, true);
  assert.equal(applied.entry.devCaseId, null, "precondition: the apply knew nothing of an assignment");

  const promoted = createPipelineEntry({
    candidateId: "profile-twice",
    candidateLabel: "Twice Tereza",
    jobId: "jd-backend-eng",
    jobTitle: "Backend Engineer",
    devCaseId: "dc_beta",
    devSubmissionId: "sub_beta",
    workspaceId: WS,
  });
  assert.equal(promoted.created, false, "no second row for the same person on the same role");
  assert.equal(promoted.entry.id, applied.entry.id);
  assert.equal(getPipelineEntry(applied.entry.id, WS)?.devCaseId, "dc_beta", "the link lands on the row that already existed");
  assert.equal(getPipelineEntry(applied.entry.id, WS)?.devSubmissionId, "sub_beta");
});

test("a second promote can never re-point an entry at different material", () => {
  // FILL-ONLY, the same discipline githubJson carries. Overwriting would silently
  // swap the case the interview brief grounds on, under a reviewer who saw the first.
  createPipelineEntry({
    candidateId: "profile-fixed",
    candidateLabel: "Fixed Filip",
    jobId: "jd-backend-eng",
    jobTitle: "Backend Engineer",
    devCaseId: "dc_first",
    devSubmissionId: "sub_first",
    workspaceId: WS,
  });
  const again = createPipelineEntry({
    candidateId: "profile-fixed",
    candidateLabel: "Fixed Filip",
    jobId: "jd-backend-eng",
    jobTitle: "Backend Engineer",
    devCaseId: "dc_second",
    devSubmissionId: "sub_second",
    workspaceId: WS,
  });
  assert.equal(again.entry.devCaseId, "dc_first");
  assert.equal(again.entry.devSubmissionId, "sub_first");
});

// --- the contact join: one person, not two ---------------------------------

test("a known contact resolves to the profile this team already files them under", () => {
  createPipelineEntry({
    candidateId: "profile-jana",
    candidateLabel: "Jana Nová",
    jobId: "jd-backend-eng",
    jobTitle: "Backend Engineer",
    contact: "Jana@Example.com",
    workspaceId: WS,
  });
  // Case/whitespace-insensitive, because the address is the identity, not its casing.
  assert.equal(candidateIdByContact("jana@example.com", WS), "profile-jana");
  assert.equal(candidateIdByContact("  JANA@EXAMPLE.COM ", WS), "profile-jana");
});

test("the contact join is workspace-scoped — an address is not an authority on another team's board", () => {
  assert.equal(candidateIdByContact("jana@example.com", DEFAULT_WORKSPACE_ID), null);
});

test("an AMBIGUOUS contact resolves to nobody rather than to a coin flip", () => {
  // Two distinct people under one address is a state we cannot resolve without
  // guessing, and the wrong guess writes an assignment's evidence onto a stranger.
  createPipelineEntry({
    candidateId: "profile-shared-a",
    candidateLabel: "Shared A",
    jobId: "jd-backend-eng",
    jobTitle: "Backend Engineer",
    contact: "shared@example.com",
    workspaceId: WS,
  });
  createPipelineEntry({
    candidateId: "profile-shared-b",
    candidateLabel: "Shared B",
    jobId: "jd-marketing",
    jobTitle: "Marketing",
    contact: "shared@example.com",
    workspaceId: WS,
  });
  assert.equal(candidateIdByContact("shared@example.com", WS), null);
});

test("a legacy synthetic candidate is not a resolvable identity", () => {
  // "ds-<submissionId>" is the very thing this join replaces: there is no profiles
  // row behind it, so resolving to one would re-enter the identity we are leaving.
  createPipelineEntry({
    candidateId: "ds-sub_legacy",
    candidateLabel: "Legacy Lukas",
    jobId: "dc-dc_legacy",
    jobTitle: "Dev case",
    contact: "legacy@example.com",
    workspaceId: WS,
  });
  assert.equal(candidateIdByContact("legacy@example.com", WS), null);
});

test("no contact is no join — a blank address never matches the blank-contact rows", () => {
  assert.equal(candidateIdByContact(null, WS), null);
  assert.equal(candidateIdByContact("   ", WS), null);
  assert.equal(candidateIdByContact("nobody@example.com", WS), null);
});
