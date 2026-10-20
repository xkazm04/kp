import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
// IMPORT ORDER IS LOAD-BEARING: see skill-profiles-key-rotation.test.ts.
import { cleanupUnitDb, UNIT_DB_PATH } from "../testing/unit-db.ts";
import { issueSkillProfile, verifySkillProfileToken } from "./skill-profiles.ts";
import { getSubmission } from "./devcase.ts";
import { buildDurableSkillProfile, DSP_VERSION } from "../skill-profile.ts";
import { canonicalize } from "../decision-hash.ts";
import { randomId } from "../random-id.ts";

// A retired key is not a compromised one. Keeping every retired key loadable is right for
// rotation and wrong for a leak: anyone holding the leaked secret can mint a row that
// recomputes correctly under it. Marking the key id COMPROMISED refuses that generation
// (unverifiable, never tampered) while credentials under the other keys keep verifying.

function pageState(v: { revoked: boolean; verifiable: boolean; valid: boolean; substantive: boolean }): string {
  return v.revoked ? "revoked" : !v.verifiable ? "unverifiable" : !v.valid ? "tampered" : !v.substantive ? "incomplete" : "verified";
}

function resetKeyEnv(): void {
  for (const k of [
    "KP_SECRET",
    "KP_SKILL_PROFILE_KEY",
    "KP_SKILL_PROFILE_KEY_ID",
    "KP_SKILL_PROFILE_KEY_k1",
    "KP_SKILL_PROFILE_KEY_k2",
    "KP_SKILL_PROFILE_KEY_k1_COMPROMISED",
  ]) {
    delete process.env[k];
  }
}

function raw(): Database.Database {
  return new Database(UNIT_DB_PATH);
}

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

/** What a holder of the leaked secret can do: write a row for a profile of their choosing
 *  whose MAC recomputes correctly under the key id (same construction as the store's own). */
function forgeUnderLeakedKey(secret: string, keyId: string): string {
  const issuedAt = "2026-01-01T00:00:00.000Z"; // backdated: the time is theirs to choose
  const profile = buildDurableSkillProfile({
    candidateRef: "forged-cand",
    caseId: null,
    issuedAt,
    eval: { evaluation: { dimensionScores: { coding: 99, communication: 99 }, confidence: 0.99 }, transfer: { transferScore: 99 } },
  });
  const signature = createHmac("sha256", secret).update(keyId).update("\n").update(canonicalize(profile)).digest("hex");
  const token = randomId("dsp");
  const d = raw();
  d.prepare(
    `INSERT INTO skill_profiles (token, access_token, submission_id, candidate_ref, case_id, profile_json, signature, version, issued_at, revoked_at, workspace_id, key_id)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, 'workspace', ?)`
  ).run(token, "sub_forged", profile.candidateRef, profile.caseId, JSON.stringify(profile), signature, DSP_VERSION, issuedAt, keyId);
  d.close();
  return token;
}

before(() => {
  getSubmission("__init__");
});

after(() => {
  resetKeyEnv();
  cleanupUnitDb();
});

test("a leaked retired key forges a verified credential until it is marked compromised, and only its own generation goes grey", () => {
  resetKeyEnv();
  process.env.KP_SKILL_PROFILE_KEY = "dsp-key-k1";
  process.env.KP_SKILL_PROFILE_KEY_ID = "k1";
  seedEvaluatedSubmission("sub_cmp1", "cand-cmp1");
  const genuineOld = issueSkillProfile("sub_cmp1");
  assert.ok(genuineOld.ok);
  if (!genuineOld.ok) return;

  // Rotate k1 -> k2, keeping k1 loadable as a retired key.
  process.env.KP_SKILL_PROFILE_KEY = "dsp-key-k2";
  process.env.KP_SKILL_PROFILE_KEY_ID = "k2";
  process.env.KP_SKILL_PROFILE_KEY_k1 = "dsp-key-k1";
  seedEvaluatedSubmission("sub_cmp2", "cand-cmp2");
  const genuineNew = issueSkillProfile("sub_cmp2");
  assert.ok(genuineNew.ok);
  if (!genuineNew.ok) return;

  // k1 leaks. The forger writes a row that recomputes under it.
  const forged = forgeUnderLeakedKey("dsp-key-k1", "k1");

  // BEFORE marking it: the forgery is indistinguishable from a genuine credential.
  assert.equal(pageState(verifySkillProfileToken(forged)), "verified", "a leaked retired key verifies a forged credential");
  assert.equal(pageState(verifySkillProfileToken(genuineOld.token)), "verified");
  assert.equal(pageState(verifySkillProfileToken(genuineNew.token)), "verified");

  // Mark k1 compromised.
  process.env.KP_SKILL_PROFILE_KEY_k1_COMPROMISED = "1";
  assert.equal(pageState(verifySkillProfileToken(forged)), "unverifiable", "the forgery no longer passes, and is not branded tampered");
  assert.equal(pageState(verifySkillProfileToken(genuineOld.token)), "unverifiable", "the cost: genuine k1 credentials go grey until reissued");
  assert.equal(pageState(verifySkillProfileToken(genuineNew.token)), "verified", "credentials under the other key are untouched");

  // Lifting the mark restores the pre-compromise state (the flag is a verifier setting, not data).
  delete process.env.KP_SKILL_PROFILE_KEY_k1_COMPROMISED;
  assert.equal(pageState(verifySkillProfileToken(genuineOld.token)), "verified");
});
