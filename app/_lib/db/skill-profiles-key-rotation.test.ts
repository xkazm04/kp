import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file at module-eval
// time and must run BEFORE any module that transitively touches db-path (skill-profiles ->
// core -> db-path). Keep it above the app-module imports.
import { cleanupUnitDb, UNIT_DB_PATH } from "../testing/unit-db.ts";
import { issueSkillProfile, verifySkillProfileToken, getSkillProfileByToken } from "./skill-profiles.ts";
import { getSubmission } from "./devcase.ts";
import { buildDurableSkillProfile, signProfile, verifyProfile, DSP_VERSION } from "../skill-profile.ts";
import { randomId } from "../random-id.ts";

// bug-ui-scan-2026-07-09 #1 — the /skill/[token] verification MAC used to be keyed on the
// rotatable auth secret KP_SECRET, so rotating it (or a redeploy with it unset) recomputed
// every signature to a mismatch and the page branded genuine, non-revoked credentials as red
// "TAMPERED" fraud. The fix keys new credentials on a DEDICATED, versioned key
// (KP_SKILL_PROFILE_KEY + a per-row key_id), keeps legacy (key_id '') rows verifying, and
// makes an unset/misconfigured key a NEUTRAL "cannot verify" state (not "tampered"). These
// tests pin all of that. Real DB (the store's own connection), seeded via a second
// connection on the same throwaway file (the skill-profiles-token.test pattern).

// The exact state ladder from app/skill/[token]/page.tsx — the badge a third party sees.
// "unverifiable" MUST out-rank "tampered": a config error is never a fraud accusation.
function pageState(v: { revoked: boolean; verifiable: boolean; valid: boolean; substantive: boolean }): string {
  return v.revoked ? "revoked" : !v.verifiable ? "unverifiable" : !v.valid ? "tampered" : !v.substantive ? "incomplete" : "verified";
}

function resetKeyEnv(): void {
  for (const k of [
    "KP_SECRET",
    "KP_SKILL_PROFILE_KEY",
    "KP_SKILL_PROFILE_KEY_ID",
    "KP_SKILL_PROFILE_LEGACY_KEY",
    "KP_SKILL_PROFILE_KEY_k1",
    "KP_SKILL_PROFILE_KEY_k2",
  ]) {
    delete process.env[k];
  }
}

function raw(): Database.Database {
  return new Database(UNIT_DB_PATH);
}

/** Seed an evaluated, substantive dev submission (the earned-not-given precondition) via a
 *  second connection on the shared file. */
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

function readRow(submissionId: string): { key_id: string | null; signature: string; profile_json: string } | undefined {
  const d = raw();
  const r = d.prepare(`SELECT key_id, signature, profile_json FROM skill_profiles WHERE submission_id = ?`).get(submissionId) as
    | { key_id: string | null; signature: string; profile_json: string }
    | undefined;
  d.close();
  return r;
}

// Force ensureDb() init (creates skill_profiles + dev_submissions) BEFORE seeding via a
// second connection. The idempotent key_id ADD COLUMN runs on the first store() call below.
before(() => {
  getSubmission("__init__");
});

after(() => {
  resetKeyEnv();
  cleanupUnitDb();
});

test("a dedicated-key credential survives a KP_SECRET rotation AND a KP_SKILL_PROFILE_KEY rotation", () => {
  resetKeyEnv();
  process.env.KP_SECRET = "auth-secret-v1"; // present, but must be irrelevant to a keyed row
  process.env.KP_SKILL_PROFILE_KEY = "dsp-key-k1";
  process.env.KP_SKILL_PROFILE_KEY_ID = "k1";

  seedEvaluatedSubmission("sub_rot", "cand-rot");
  const res = issueSkillProfile("sub_rot");
  assert.ok(res.ok, "an evaluated, substantive submission should mint");
  if (!res.ok) return;
  const token = res.token;

  // The credential records the dedicated key id — NOT the legacy '' / KP_SECRET scheme.
  const row = readRow("sub_rot");
  assert.equal(row?.key_id, "k1", "the credential is stamped with the dedicated key id it was signed under");

  // Fresh mint verifies.
  let v = verifySkillProfileToken(token);
  assert.equal(v.found, true);
  assert.equal(v.valid, true);
  assert.equal(v.verifiable, true);
  assert.equal(pageState(v), "verified");

  // NON-VACUITY: the PRE-FIX verifier (verifyProfile = HMAC over KP_SECRET, no key_id) does
  // NOT accept a dedicated-key credential. Pre-fix, verifySkillProfileToken WAS exactly this
  // call, so it would have returned valid:false and the page would show "tampered" here —
  // the very defect this test guards. Verification now routes through the dedicated key.
  assert.equal(verifyProfile(res.profile, row!.signature), false, "the old KP_SECRET verifier must NOT validate a dedicated-key credential");

  // Rotate the AUTH secret entirely. Pre-fix this branded every outstanding credential
  // "TAMPERED"; now it is a no-op on the credential surface.
  process.env.KP_SECRET = "auth-secret-ROTATED";
  v = verifySkillProfileToken(token);
  assert.equal(v.valid, true, "rotating KP_SECRET must not invalidate a dedicated-key credential");
  assert.equal(pageState(v), "verified");

  // Rotate the DEDICATED key k1 -> k2, keeping k1 available as a retired key.
  process.env.KP_SKILL_PROFILE_KEY = "dsp-key-k2";
  process.env.KP_SKILL_PROFILE_KEY_ID = "k2";
  process.env.KP_SKILL_PROFILE_KEY_k1 = "dsp-key-k1";
  v = verifySkillProfileToken(token);
  assert.equal(v.valid, true, "an already-issued credential verifies under its retired key after rotation");
  assert.equal(pageState(v), "verified");

  // New mints seal under the new active key k2.
  seedEvaluatedSubmission("sub_rot2", "cand-rot2");
  const res2 = issueSkillProfile("sub_rot2");
  assert.ok(res2.ok);
  assert.equal(readRow("sub_rot2")?.key_id, "k2", "post-rotation mints record the new active key id");

  // Drop the retired key: the OLD credential can no longer be checked -> UNVERIFIABLE
  // (config), NOT tampered. This is the "unset/misconfigured key" contract.
  delete process.env.KP_SKILL_PROFILE_KEY_k1;
  v = verifySkillProfileToken(token);
  assert.equal(v.valid, false);
  assert.equal(v.verifiable, false, "no key material for the row's id => cannot verify, not tampered");
  assert.equal(pageState(v), "unverifiable");
});

test("a genuinely tampered credential fails as TAMPERED (a real mismatch, not a config error)", () => {
  resetKeyEnv();
  process.env.KP_SKILL_PROFILE_KEY = "dsp-key-tamper";
  process.env.KP_SKILL_PROFILE_KEY_ID = "k1";

  seedEvaluatedSubmission("sub_tamper", "cand-t");
  const res = issueSkillProfile("sub_tamper");
  assert.ok(res.ok);
  if (!res.ok) return;
  const token = res.token;

  // Forge the content: inflate the stored transferScore WITHOUT re-signing.
  const d = raw();
  const before = d.prepare(`SELECT profile_json FROM skill_profiles WHERE submission_id = ?`).get("sub_tamper") as { profile_json: string };
  const forged = JSON.parse(before.profile_json);
  forged.transferScore = 100;
  d.prepare(`UPDATE skill_profiles SET profile_json = ? WHERE submission_id = ?`).run(JSON.stringify(forged), "sub_tamper");
  d.close();

  const v = verifySkillProfileToken(token);
  assert.equal(v.found, true);
  assert.equal(v.valid, false, "forged content must not validate");
  assert.equal(v.verifiable, true, "the key IS present, so this is a genuine content mismatch, not a config error");
  assert.equal(pageState(v), "tampered");
});

test("legacy credential: KP_SECRET unset/rotated is 'cannot verify', never 'tampered' (the finding scenario)", () => {
  resetKeyEnv();
  process.env.KP_SECRET = "legacy-auth-v1";

  // Reproduce a pre-change row: signed by the REAL old signer under KP_SECRET, key_id ''.
  const issuedAt = new Date().toISOString();
  const profile = buildDurableSkillProfile({
    candidateRef: "legacy-cand",
    caseId: null,
    issuedAt,
    eval: { evaluation: { dimensionScores: { coding: 91 }, confidence: 0.8 }, transfer: { transferScore: 87 } },
  });
  const signature = signProfile(profile); // the original KP_SECRET-keyed signature
  const legacyToken = randomId("dsp");
  const d = raw();
  // Insert WITHOUT key_id so it backfills to '' — a genuine legacy row.
  d.prepare(
    `INSERT INTO skill_profiles (token, access_token, submission_id, candidate_ref, case_id, profile_json, signature, version, issued_at, revoked_at, workspace_id)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, 'workspace')`
  ).run(legacyToken, "sub_legacy_rot", profile.candidateRef, profile.caseId, JSON.stringify(profile), signature, DSP_VERSION, issuedAt);
  d.close();

  // Sanity: the row is legacy (key_id '') and the already-shared link still resolves + verifies.
  assert.equal(readRow("sub_legacy_rot")?.key_id ?? "", "", "seeded row is a legacy (key_id '') row");
  assert.ok(getSkillProfileByToken(legacyToken), "the already-shared legacy link must still resolve");
  let v = verifySkillProfileToken(legacyToken);
  assert.equal(v.valid, true, "a legacy credential keeps verifying under KP_SECRET");
  assert.equal(v.verifiable, true);
  assert.equal(pageState(v), "verified");

  // KP_SECRET UNSET (redeploy / second env without it): NEUTRAL cannot-verify, NOT the red
  // fraud badge. This is exactly the defamation the finding reported — now defused.
  // NON-VACUITY: pre-fix, verifyProfile threw on the missing secret, the catch returned
  // false, and the page's `!valid ? "tampered"` branch rendered red. There was no
  // verifiable flag, so this assertion could not have held.
  delete process.env.KP_SECRET;
  v = verifySkillProfileToken(legacyToken);
  assert.equal(v.valid, false);
  assert.equal(v.verifiable, false, "an unset legacy secret is a config error, not tampering");
  assert.equal(pageState(v), "unverifiable");

  // KP_SECRET ROTATED to a new value: pin the OLD value in KP_SKILL_PROFILE_LEGACY_KEY and
  // outstanding legacy credentials survive the rotation unbroken.
  process.env.KP_SECRET = "auth-secret-v2";
  process.env.KP_SKILL_PROFILE_LEGACY_KEY = "legacy-auth-v1";
  v = verifySkillProfileToken(legacyToken);
  assert.equal(v.valid, true, "pinning the retired auth secret keeps legacy credentials verifying across a KP_SECRET rotation");
  assert.equal(pageState(v), "verified");
});
