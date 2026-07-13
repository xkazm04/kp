import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file at module-eval
// time and must run BEFORE any module that transitively touches db-path (skill-profiles →
// core → db-path). Keep it above the app-module imports.
import { cleanupUnitDb, UNIT_DB_PATH } from "../testing/unit-db.ts";
import { issueSkillProfile, verifySkillProfileToken } from "./skill-profiles.ts";
import { getSubmission, saveSubmissionEvaluation } from "./devcase.ts";

// bug-ui-scan-2026-07-09 (dev-lifecycle-cohort-outcomes #4): a Durable Skill Profile is minted
// idempotently per submission_id. Before this fix, re-evaluating a submission (recruiter fixes
// the rubric → saveSubmissionEvaluation overwrites eval_json + transfer_score) left the live
// credential UNTOUCHED: the next issueSkillProfile handed back the ORIGINAL profile, so the
// public /skill card silently attested scores the system no longer believed. These pin that a
// CONTENT change forces a reissue (fresh token + the stale credential revoked) while an
// unchanged re-issue stays truly idempotent (same token, nothing revoked).

// Signing needs KP_SECRET; unit-db doesn't manage it. Read at call time, so set before mint.
process.env.KP_SECRET = "unit-test-kp-secret-skill-reissue";

function raw(): Database.Database {
  return new Database(UNIT_DB_PATH);
}

/** Seed an evaluated, substantive dev submission directly, via a second connection. */
function seedEvaluatedSubmission(id: string, coding: number): void {
  const d = raw();
  const evalBundle = {
    evaluation: { dimensionScores: { coding, communication: 71 }, confidence: 0.9 },
    transfer: { transferScore: 78 },
  };
  d.prepare(
    `INSERT INTO dev_submissions (id, posting_id, candidate_ref, repo_ref, status, eval_json, transfer_score, received_at)
     VALUES (?, NULL, ?, ?, 'evaluated', ?, ?, ?)`
  ).run(id, `cand-${id}`, `repo:${id}`, JSON.stringify(evalBundle), 78, new Date().toISOString());
  d.close();
}

/** Count non-revoked profiles for a submission (a reissue must supersede, never accumulate). */
function liveProfileCount(submissionId: string): number {
  const d = raw();
  const n = (d.prepare(`SELECT COUNT(*) AS n FROM skill_profiles WHERE submission_id = ? AND revoked_at IS NULL`).get(submissionId) as { n: number }).n;
  d.close();
  return n;
}

before(() => {
  getSubmission("__init__"); // force full ensureDb() init before seeding via a 2nd connection
});

after(() => cleanupUnitDb());

test("an unchanged re-issue is idempotent — same token, nothing revoked", () => {
  seedEvaluatedSubmission("sub_reissue_same", 82);
  const first = issueSkillProfile("sub_reissue_same");
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.created, true);

  const second = issueSkillProfile("sub_reissue_same");
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.equal(second.created, false, "no evaluation change ⇒ reuse the existing credential");
  assert.equal(second.token, first.token);
  assert.equal(liveProfileCount("sub_reissue_same"), 1);
  assert.equal(verifySkillProfileToken(first.token).valid, true);
});

test("re-evaluation supersedes the stale credential — fresh token, old one revoked", () => {
  seedEvaluatedSubmission("sub_reissue_changed", 82);
  const first = issueSkillProfile("sub_reissue_changed");
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.equal(first.created, true);
  const oldToken = first.token;

  // Recruiter re-runs evaluation after a rubric fix — the coding axis moves 82 → 95.
  saveSubmissionEvaluation(
    "sub_reissue_changed",
    { evaluation: { dimensionScores: { coding: 95, communication: 71 }, confidence: 0.9 }, transfer: { transferScore: 78 } },
    78
  );

  const second = issueSkillProfile("sub_reissue_changed");
  assert.ok(second.ok);
  if (!second.ok) return;
  // Pre-fix: second.created === false and second.token === oldToken (the stale profile), and
  // the old credential stayed valid. These assertions FAIL against that blind idempotency.
  assert.equal(second.created, true, "a changed evaluation must mint a fresh credential");
  assert.notEqual(second.token, oldToken);
  assert.equal(second.profile.axes.coding, 95, "the fresh credential attests the corrected score");

  // The stale credential is revoked (no longer a valid live attestation), and exactly one
  // live profile remains for the submission.
  const oldVerdict = verifySkillProfileToken(oldToken);
  assert.equal(oldVerdict.revoked, true);
  assert.equal(oldVerdict.valid, false);
  assert.equal(verifySkillProfileToken(second.token).valid, true);
  assert.equal(liveProfileCount("sub_reissue_changed"), 1);
});
