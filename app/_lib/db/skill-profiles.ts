import { ensureDb } from "./core";
import { randomId } from "../random-id";
import { getPosting, getSubmission } from "./devcase";
import {
  buildDurableSkillProfile,
  isSubstantiveSkillProfile,
  signProfile,
  verifyProfile,
  DSP_VERSION,
  type DurableSkillProfile,
  type EvalForProfile,
} from "../skill-profile";

// Durable Skill Profile (moonshot A) — persistence + the earned-not-given mint.
// Shared connection (devcase pattern). A profile is minted ONLY from an evaluated
// submission, signed with KP_SECRET, and addressed by a candidate-owned token.

export type IssuedSkillProfile = {
  token: string;
  profile: DurableSkillProfile;
  signature: string;
  issuedAt: string;
  revokedAt: string | null;
};

export type SkillProfileVerdict = {
  found: boolean;
  valid: boolean; // signature recomputes AND not revoked
  revoked: boolean;
  // The signature attests INTEGRITY, not substance: a validly-signed profile can still
  // be empty (no axes, transfer score 0). `substantive` separates "real attestation"
  // from "validly-signed but says nothing", so the card doesn't show a green shield
  // over a 0. False when there's no profile.
  substantive: boolean;
  profile: DurableSkillProfile | null;
};

type Row = {
  token: string;
  submission_id: string | null;
  candidate_ref: string | null;
  case_id: string | null;
  profile_json: string;
  signature: string;
  version: string;
  issued_at: string;
  revoked_at: string | null;
};

function rowToIssued(r: Row): IssuedSkillProfile | null {
  try {
    return {
      token: r.token,
      profile: JSON.parse(r.profile_json) as DurableSkillProfile,
      signature: r.signature,
      issuedAt: r.issued_at,
      revokedAt: r.revoked_at,
    };
  } catch {
    return null; // corrupt artifact JSON — treat as absent, never crash a public page
  }
}

export type IssueResult =
  | { ok: true; token: string; profile: DurableSkillProfile; created: boolean }
  | { ok: false; reason: "not_found" | "not_evaluated" };

/** Mint (or return the existing) Durable Skill Profile for a submission. Earned-
 *  not-given: refuses unless the submission is evaluated. Idempotent per submission
 *  (one live profile per graded submission). Signing requires KP_SECRET. */
export function issueSkillProfile(submissionId: string): IssueResult {
  const db = ensureDb();
  const sub = getSubmission(submissionId);
  if (!sub) return { ok: false, reason: "not_found" };
  if (sub.status !== "evaluated" || sub.transferScore == null) return { ok: false, reason: "not_evaluated" };

  // Idempotent: reuse a non-revoked profile already minted for this submission.
  const existingRow = db
    .prepare(`SELECT * FROM skill_profiles WHERE submission_id = ? AND revoked_at IS NULL ORDER BY issued_at DESC LIMIT 1`)
    .get(submissionId) as Row | undefined;
  if (existingRow) {
    const issued = rowToIssued(existingRow);
    if (issued) return { ok: true, token: issued.token, profile: issued.profile, created: false };
  }

  const posting = sub.postingId ? getPosting(sub.postingId) : null;
  const issuedAt = new Date().toISOString();
  const profile = buildDurableSkillProfile({
    candidateRef: sub.candidateRef ?? "candidate",
    caseId: posting?.caseId ?? null,
    issuedAt,
    eval: (sub.evaluation ?? {}) as EvalForProfile,
  });
  // Earned-not-given AND substantive: an "evaluated" submission whose bundle carries
  // no dimension scores and a 0 transfer score builds to an EMPTY profile (axes={},
  // score 0). Signing it would issue a green "verified" credential that attests
  // nothing — refuse, like a non-evaluated submission.
  if (!isSubstantiveSkillProfile(profile)) return { ok: false, reason: "not_evaluated" };
  const signature = signProfile(profile);
  const token = randomId("dsp");
  db.prepare(
    `INSERT INTO skill_profiles (token, submission_id, candidate_ref, case_id, profile_json, signature, version, issued_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(token, submissionId, profile.candidateRef, profile.caseId, JSON.stringify(profile), signature, DSP_VERSION, issuedAt);
  return { ok: true, token, profile, created: true };
}

export function getSkillProfileByToken(token: string): IssuedSkillProfile | null {
  const db = ensureDb();
  const r = db.prepare(`SELECT * FROM skill_profiles WHERE token = ?`).get(token) as Row | undefined;
  return r ? rowToIssued(r) : null;
}

/** Verify a presented token: the stored signature must recompute under the current
 *  KP_SECRET AND the profile must not be revoked. This is the public "is this real?"
 *  lookup (the FICO-style trust model). */
export function verifySkillProfileToken(token: string): SkillProfileVerdict {
  const issued = getSkillProfileByToken(token);
  if (!issued) return { found: false, valid: false, revoked: false, substantive: false, profile: null };
  const revoked = issued.revokedAt != null;
  const signatureOk = verifyProfile(issued.profile, issued.signature);
  // A pre-fix profile may already be empty; report substance so the page/API can show
  // a muted state instead of a confident green verdict over no content.
  const substantive = isSubstantiveSkillProfile(issued.profile);
  return { found: true, valid: signatureOk && !revoked, revoked, substantive, profile: issued.profile };
}

export function revokeSkillProfile(token: string): boolean {
  const db = ensureDb();
  return db.prepare(`UPDATE skill_profiles SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL`).run(new Date().toISOString(), token).changes > 0;
}
