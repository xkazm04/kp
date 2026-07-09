import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file at
// module-eval time, and it must run BEFORE any module that transitively touches
// db-path (skill-profiles → core → db-path). Keep it above the app-module imports.
import { cleanupUnitDb, UNIT_DB_PATH } from "../testing/unit-db.ts";
import { issueSkillProfile, getSkillProfileByToken, verifySkillProfileToken } from "./skill-profiles.ts";
import { getSubmission } from "./devcase.ts";
import { buildDurableSkillProfile, signProfile, DSP_VERSION } from "../skill-profile.ts";
import { randomId } from "../random-id.ts";

// bug-ui-scan-2026-07-09 #1 — the public skill-profile credential token gates a PII
// surface (scores, axes, a "verified" attestation) with NO other auth, so it must be
// a CSPRNG value, not the guessable/enumerable time-ordered randomId. These tests pin
// (a) that a minted token is CSPRNG-shaped and is NOT the sequential PK, and (b) that a
// legacy randomId-format token still verifies — the backward-compat path that keeps
// every already-shared link alive. Real DB (the store's own connection), seeded via a
// second connection on the same throwaway SQLite file (the offers-store test pattern).

// Signing needs KP_SECRET; set a deterministic one (unit-db doesn't manage it). Read at
// call time by signProfile/verifyProfile, so setting it before the first mint suffices.
process.env.KP_SECRET = "unit-test-kp-secret-skill-profiles";

// randomToken("dsp") -> "dsp-" + 32 base64url chars (24 CSPRNG bytes, ~192 bits).
const CSPRNG_TOKEN = /^dsp-[A-Za-z0-9_-]{32}$/;
// randomId("dsp") -> "dsp-<base36 Date.now()>-<6 base36 Math.random()>".
const RANDOM_ID = /^dsp-[0-9a-z]+-[0-9a-z]{6}$/;

function raw(): Database.Database {
  return new Database(UNIT_DB_PATH);
}

/** Seed an evaluated, substantive dev submission (the earned-not-given precondition
 *  issueSkillProfile enforces) directly, via a second connection on the shared file. */
function seedEvaluatedSubmission(id: string, candidateRef: string): void {
  const d = raw();
  const evalBundle = {
    evaluation: { dimensionScores: { coding: 82, communication: 71 }, confidence: 0.9 },
    transfer: { transferScore: 78 },
  };
  d.prepare(
    `INSERT INTO dev_submissions (id, posting_id, candidate_ref, repo_ref, status, eval_json, transfer_score, received_at)
     VALUES (?, NULL, ?, ?, 'evaluated', ?, ?, ?)`
  ).run(id, candidateRef, `repo:${id}`, JSON.stringify(evalBundle), 78, new Date().toISOString());
  d.close();
}

function readProfileRow(submissionId: string): { token: string; access_token: string | null } | undefined {
  const d = raw();
  const r = d.prepare(`SELECT token, access_token FROM skill_profiles WHERE submission_id = ?`).get(submissionId) as
    | { token: string; access_token: string | null }
    | undefined;
  d.close();
  return r;
}

// Force the full ensureDb() init (creates skill_profiles WITH the new access_token
// column + dev_submissions) BEFORE we seed rows through a second connection.
before(() => {
  getSubmission("__init__");
});

after(() => cleanupUnitDb());

test("issueSkillProfile mints a CSPRNG public token, distinct from the guessable randomId PK", () => {
  seedEvaluatedSubmission("sub_mint_1", "cand-1");
  const res = issueSkillProfile("sub_mint_1");
  assert.ok(res.ok, "an evaluated, substantive submission should mint");
  if (!res.ok) return;
  assert.equal(res.created, true, "first mint creates a row");

  // (1) CSPRNG shape: "dsp-" + exactly 32 base64url chars.
  assert.match(res.token, CSPRNG_TOKEN);
  assert.equal(res.token.length, 36);
  const suffix = res.token.slice(4);
  assert.equal(suffix.length, 32);

  // (2) Entropy smell test: 32 CSPRNG base64url chars are nearly all distinct. A
  // time-ordered randomId suffix (~15 chars over a 36-symbol alphabet, sharing a
  // near-fixed millisecond prefix) could never reach this.
  assert.ok(new Set(suffix).size >= 12, `token suffix looks low-entropy: ${suffix}`);

  // (3) It is NOT the dsp_-prefixed sequential id. The row's PRIMARY KEY stays a
  // randomId (internal, guessable-is-fine); the PUBLIC token is the separate CSPRNG
  // access_token. The returned token is exactly that access_token.
  const row = readProfileRow("sub_mint_1");
  assert.ok(row, "the row was persisted");
  assert.equal(row!.access_token, res.token, "returned token is the CSPRNG access_token");
  assert.notEqual(row!.token, res.token, "the public token is NOT the sequential PK");
  assert.match(row!.token, RANDOM_ID, "the PK is a randomId");

  // (4) The freshly minted CSPRNG token verifies end-to-end (access_token lookup + HMAC).
  const verdict = verifySkillProfileToken(res.token);
  assert.equal(verdict.found, true);
  assert.equal(verdict.valid, true);
});

test("two mints yield unrelated CSPRNG tokens (no shared time-ordered prefix)", () => {
  seedEvaluatedSubmission("sub_mint_a", "cand-a");
  seedEvaluatedSubmission("sub_mint_b", "cand-b");
  const a = issueSkillProfile("sub_mint_a");
  const b = issueSkillProfile("sub_mint_b");
  assert.ok(a.ok && b.ok);
  if (!a.ok || !b.ok) return;
  assert.notEqual(a.token, b.token);
  // randomId would share the Date.now() base36 prefix for near-simultaneous mints;
  // CSPRNG tokens share nothing past the "dsp-" namespace.
  assert.notEqual(a.token.slice(4, 10), b.token.slice(4, 10));
});

test("a legacy randomId-format token (access_token NULL) still verifies — backward compat", () => {
  const issuedAt = new Date().toISOString();
  const profile = buildDurableSkillProfile({
    candidateRef: "legacy-cand",
    caseId: null,
    issuedAt,
    eval: { evaluation: { dimensionScores: { coding: 90 }, confidence: 0.8 }, transfer: { transferScore: 88 } },
  });
  const signature = signProfile(profile);
  // Reproduce a pre-fix row: the PUBLIC token WAS the randomId PK, and access_token is NULL.
  const legacyToken = randomId("dsp");
  assert.match(legacyToken, RANDOM_ID);

  const d = raw();
  d.prepare(
    `INSERT INTO skill_profiles (token, access_token, submission_id, candidate_ref, case_id, profile_json, signature, version, issued_at, revoked_at, workspace_id)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, 'workspace')`
  ).run(legacyToken, "sub_legacy_1", profile.candidateRef, profile.caseId, JSON.stringify(profile), signature, DSP_VERSION, issuedAt);
  d.close();

  // The already-shared old link resolves via the PK fallback in getSkillProfileByToken …
  const found = getSkillProfileByToken(legacyToken);
  assert.ok(found, "legacy token must still resolve (its shared link must not break)");
  // … and still verifies as a genuine, valid credential.
  const verdict = verifySkillProfileToken(legacyToken);
  assert.equal(verdict.found, true);
  assert.equal(verdict.valid, true, "an already-issued credential link must keep verifying");
  assert.equal(verdict.substantive, true);
});
