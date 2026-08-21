import { createHmac, timingSafeEqual } from "node:crypto";
import { ensureDb } from "./core";
import { randomId, randomToken } from "../random-id";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";
import { getPosting, getSubmission } from "./devcase";
import { canonicalize } from "../decision-hash.ts";
import {
  buildDurableSkillProfile,
  isSubstantiveSkillProfile,
  DSP_VERSION,
  type DurableSkillProfile,
  type EvalForProfile,
} from "../skill-profile";

// Durable Skill Profile (moonshot A) — persistence + the earned-not-given mint.
// Shared connection (devcase pattern). A profile is minted ONLY from an evaluated
// submission, signed with a DEDICATED, VERSIONED credential key, and addressed by a
// candidate-owned token.
//
// --- Credential keying (bug-ui-scan-2026-07-09 #1: KP_SECRET rotation/absence brands
// every genuine credential "TAMPERED") --------------------------------------------------
//
// The verification MAC is keyed on a DEDICATED secret (KP_SKILL_PROFILE_KEY), NOT the
// session/provider secret KP_SECRET. KP_SECRET is a routinely-rotated auth credential;
// tying a candidate-owned, publicly-shared attestation to it means a single ops rotation
// (or a second environment with KP_SECRET unset) recomputes every signature to a mismatch
// and the /skill/[token] page brands genuine credentials as red "TAMPERED" fraud to
// employers. Decoupling the two secrets means rotating KP_SECRET never touches credentials.
//
// ROTATION. Each row stores the key id it was signed under (key_id column). The ACTIVE key
// is (KP_SKILL_PROFILE_KEY_ID, default "k1") -> KP_SKILL_PROFILE_KEY, and key_id is bound
// INTO the MAC so a stored id can't be swapped to a weaker/retired key without invalidating
// it. To rotate: pick a new id, set KP_SKILL_PROFILE_KEY to the new secret and
// KP_SKILL_PROFILE_KEY_ID to the new id, and KEEP the retired secret readable as
// KP_SKILL_PROFILE_KEY_<oldId>. verify resolves each row's key BY its stored id, so already-
// issued credentials keep verifying under the retired key while new ones sign under the new
// key — a rotation never invalidates an outstanding /skill link (same shape as commit
// 96850a3's decision-record chain).
//
// LEGACY. Rows written before this change carry key_id "" and verify under the OLD scheme
// (HMAC over the auth secret) so every already-shared link keeps working. The legacy secret
// is KP_SKILL_PROFILE_LEGACY_KEY if set, else KP_SECRET — so an operator rotating KP_SECRET
// can PIN the old value in KP_SKILL_PROFILE_LEGACY_KEY and legacy credentials survive that
// rotation too. New mints use the dedicated key and are immune to KP_SECRET rotation.
//
// UNSET / MISCONFIGURED KEY FAILS SAFELY. Verification is TRI-STATE: "ok" (matches),
// "mismatch" (key present, content forged -> genuine tamper), or "unconfigured" (no key
// material available at all -> a SERVER CONFIG problem, NOT tampering). An unconfigured
// result sets verdict.verifiable=false and the page shows a NEUTRAL "cannot verify" state —
// it never accuses a genuine credential of fraud because a key was misconfigured.

const LEGACY_KEY_ID = "";

/** The active (id, secret) to sign NEW credentials, or null when the dedicated key is not
 *  configured (dev / open mode) — new rows then fall back to the legacy auth-secret scheme
 *  so local dev still mints. */
function activeSkillProfileKey(): { id: string; secret: string } | null {
  const secret = process.env.KP_SKILL_PROFILE_KEY?.trim();
  if (!secret) return null;
  const id = process.env.KP_SKILL_PROFILE_KEY_ID?.trim() || "k1";
  return { id, secret };
}

/** Every secret that may key a row's stored key id, most-specific first: an explicitly
 *  PINNED KP_SKILL_PROFILE_KEY_<id> (a retired key the operator kept readable), plus the
 *  ACTIVE KP_SKILL_PROFILE_KEY when the row's id IS the active id.
 *
 *  BOTH are tried, because the two can legitimately disagree for one id. The active id
 *  DEFAULTS to "k1", so "rotate KP_SKILL_PROFILE_KEY" without also bumping
 *  KP_SKILL_PROFILE_KEY_ID is the easiest half-step of the rotation runbook to take —
 *  and resolving that id to the active secret ALONE recomputes every outstanding k1
 *  credential to a mismatch and brands genuine attestations red "TAMPERED" to employers,
 *  the exact fraud accusation this module exists to prevent, even when the operator DID
 *  pin the retired secret as KP_SKILL_PROFILE_KEY_k1. Accepting either candidate keeps
 *  both the pre- and post-rotation credentials verifiable while a forgery still matches
 *  NEITHER (both values are operator-supplied key material for that id, so trying both
 *  weakens nothing). An EMPTY list = no key material at all -> verify reports
 *  "unconfigured" (cannot verify), NOT "mismatch" (tampered). */
function skillProfileKeysById(keyId: string): string[] {
  const secrets: string[] = [];
  const pinned = process.env[`KP_SKILL_PROFILE_KEY_${keyId}`]?.trim();
  if (pinned) secrets.push(pinned);
  const activeId = process.env.KP_SKILL_PROFILE_KEY_ID?.trim() || "k1";
  const active = keyId === activeId ? process.env.KP_SKILL_PROFILE_KEY?.trim() : "";
  if (active && !secrets.includes(active)) secrets.push(active);
  return secrets;
}

/** The secret legacy (key_id "") rows are verified under: the pinned KP_SKILL_PROFILE_LEGACY_KEY
 *  if set (so a KP_SECRET rotation can't break outstanding legacy credentials), else KP_SECRET
 *  (the value they were originally signed with). null when neither is set -> "unconfigured". */
function legacySkillProfileSecret(): string | null {
  return process.env.KP_SKILL_PROFILE_LEGACY_KEY?.trim() || process.env.KP_SECRET?.trim() || null;
}

/** KEYED signature: HMAC-SHA256 under the dedicated key, with key_id bound in (mirrors
 *  decisionContentMac). */
function skillProfileMac(dsp: DurableSkillProfile, keyId: string, secret: string): string {
  return createHmac("sha256", secret).update(keyId).update("\n").update(canonicalize(dsp)).digest("hex");
}

/** LEGACY signature: the original scheme (HMAC over the auth secret, no key_id) — kept
 *  byte-identical to the pre-change signProfile so already-issued rows keep verifying. */
function legacySkillProfileSignature(dsp: DurableSkillProfile, secret: string): string {
  return createHmac("sha256", secret).update(canonicalize(dsp)).digest("hex");
}

function timingSafeHexEqual(expectedHex: string, presentedHex: string): boolean {
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(typeof presentedHex === "string" ? presentedHex : "", "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

type SigCheck = "ok" | "mismatch" | "unconfigured";

/** Tri-state signature check. "unconfigured" (no key material) is a config error, distinct
 *  from "mismatch" (a real content forgery) — so the page can show a neutral "cannot verify"
 *  instead of a red "tampered" accusation when a secret is merely unset/rotated-away. */
function checkSkillProfileSignature(dsp: DurableSkillProfile, signature: string, keyId: string): SigCheck {
  if (keyId === LEGACY_KEY_ID) {
    const secret = legacySkillProfileSecret();
    if (!secret) return "unconfigured";
    return timingSafeHexEqual(legacySkillProfileSignature(dsp, secret), signature) ? "ok" : "mismatch";
  }
  const secrets = skillProfileKeysById(keyId);
  if (secrets.length === 0) return "unconfigured";
  // Constant-time per candidate; "mismatch" only when NO configured secret for this id
  // reproduces the signature (a genuine forgery), never merely a half-done rotation.
  return secrets.some((secret) => timingSafeHexEqual(skillProfileMac(dsp, keyId, secret), signature)) ? "ok" : "mismatch";
}

/** Sign a freshly-built profile: the dedicated active key when configured, else the legacy
 *  auth-secret scheme (dev/open mode). Throws only when NO key material exists at all —
 *  minting an unverifiable credential is refused (same failure mode as the old signProfile). */
function signNewSkillProfile(dsp: DurableSkillProfile): { signature: string; keyId: string } {
  const active = activeSkillProfileKey();
  if (active) return { signature: skillProfileMac(dsp, active.id, active.secret), keyId: active.id };
  const legacy = legacySkillProfileSecret();
  if (!legacy) {
    throw new Error("Neither KP_SKILL_PROFILE_KEY nor KP_SECRET is set — cannot sign a Durable Skill Profile.");
  }
  return { signature: legacySkillProfileSignature(dsp, legacy), keyId: LEGACY_KEY_ID };
}

/** ensureDb() plus a one-time, idempotent ADD COLUMN for key_id. The additive DDL lives in
 *  THIS isolated store (mirroring decision-record-store), never core.ts: existing rows
 *  backfill to '' (legacy) and new rows record the dedicated key id. The guard is bound to
 *  the db INSTANCE so a reset connection (tests) re-applies it. */
function store() {
  const db = ensureDb();
  const marked = db as unknown as { __kpSkillProfileKeyId?: boolean };
  if (!marked.__kpSkillProfileKeyId) {
    try {
      db.exec(`ALTER TABLE skill_profiles ADD COLUMN key_id TEXT NOT NULL DEFAULT ''`);
    } catch {
      /* column already exists — idempotent (same benign path as core.ts migrateExec) */
    }
    marked.__kpSkillProfileKeyId = true;
  }
  return db;
}

export type IssuedSkillProfile = {
  token: string;
  profile: DurableSkillProfile;
  signature: string;
  // The id of the key this credential was signed under ("" = a legacy row, signed under the
  // old auth-secret scheme before the credential key was introduced).
  keyId: string;
  issuedAt: string;
  revokedAt: string | null;
};

export type SkillProfileVerdict = {
  found: boolean;
  valid: boolean; // signature recomputes under the row's key AND not revoked
  revoked: boolean;
  // The signature attests INTEGRITY, not substance: a validly-signed profile can still
  // be empty (no axes, transfer score 0). `substantive` separates "real attestation"
  // from "validly-signed but says nothing", so the card doesn't show a green shield
  // over a 0. False when there's no profile.
  substantive: boolean;
  // False ONLY when the key material needed to check this credential is not configured
  // (KP_SKILL_PROFILE_KEY / a retired key / the legacy secret is unset). That is a SERVER
  // CONFIG problem, NOT evidence of tampering — so the page must render a NEUTRAL "cannot
  // verify" state, never the red "tampered" fraud accusation. True whenever we had the key
  // material to reach a real verdict, INCLUDING a genuine mismatch (valid:false).
  verifiable: boolean;
  profile: DurableSkillProfile | null;
};

type Row = {
  token: string; // internal PK (randomId) — never the public secret
  access_token: string | null; // CSPRNG public token; NULL on legacy rows (they use the PK)
  submission_id: string | null;
  candidate_ref: string | null;
  case_id: string | null;
  profile_json: string;
  signature: string;
  version: string;
  issued_at: string;
  revoked_at: string | null;
  key_id: string | null; // NULL/'' on legacy rows (verified under the old auth-secret scheme)
};

function rowToIssued(r: Row): IssuedSkillProfile | null {
  try {
    return {
      // The candidate-owned PUBLIC token: the CSPRNG access_token for hardened rows,
      // falling back to the randomId PK for legacy rows minted before the fix (whose
      // already-shared /skill/[token] links must keep working).
      token: r.access_token ?? r.token,
      profile: JSON.parse(r.profile_json) as DurableSkillProfile,
      signature: r.signature,
      keyId: r.key_id ?? LEGACY_KEY_ID,
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
  const db = store();
  const sub = getSubmission(submissionId);
  if (!sub) return { ok: false, reason: "not_found" };
  if (sub.status !== "evaluated" || sub.transferScore == null) return { ok: false, reason: "not_evaluated" };

  const posting = sub.postingId ? getPosting(sub.postingId) : null;

  // Idempotent: reuse a non-revoked profile already minted for this submission — BUT only
  // while it still attests the CURRENT evaluation. bug-ui-scan-2026-07-09
  // (dev-lifecycle-cohort-outcomes #4): a re-evaluation (saveSubmissionEvaluation overwrites
  // eval_json + transfer_score, e.g. after a rubric fix) changes the axes/score, yet a mint
  // keyed purely on submission_id kept handing back the STALE credential — the public
  // /skill card silently diverged from the corrected evaluation with no reissue path. So
  // fingerprint the live evaluation into the reuse check: rebuild the profile from today's
  // evaluation under the existing row's issuedAt (so only genuine content — axes, score,
  // confidence, case — differs, never the timestamp) and compare canonical forms. Identical
  // ⇒ nothing changed, hand back the same credential (true idempotency). Different ⇒ the
  // evaluation moved, so REVOKE the now-stale credential and fall through to mint a fresh
  // signed artifact that attests the current scores.
  //
  // The supersede is DEFERRED (not applied here) and later runs in ONE transaction with
  // the replacement INSERT. Revoking up front meant any failure between the two — most
  // concretely signNewSkillProfile() throwing when neither KP_SKILL_PROFILE_KEY nor
  // KP_SECRET is readable (a keyless/open deploy, or an env that lost the key after the
  // credential was minted) — left the candidate's live credential REVOKED with no
  // replacement, and unrecoverable: the retry re-reads `revoked_at IS NULL`, finds
  // nothing to reuse, and throws again. Every /skill link they had shared then reads red
  // "revoked" forever. Mint first, supersede atomically, or leave the credential alone.
  const existingRow = db
    .prepare(`SELECT * FROM skill_profiles WHERE submission_id = ? AND revoked_at IS NULL ORDER BY issued_at DESC LIMIT 1`)
    .get(submissionId) as Row | undefined;
  let supersedeToken: string | null = null;
  if (existingRow) {
    const issued = rowToIssued(existingRow);
    if (issued) {
      const current = buildDurableSkillProfile({
        candidateRef: sub.candidateRef ?? "candidate",
        caseId: posting?.caseId ?? null,
        issuedAt: issued.profile.issuedAt,
        eval: (sub.evaluation ?? {}) as EvalForProfile,
      });
      // Reuse when the current evaluation still builds the SAME attested content. Only a
      // substantive rebuild can supersede — a re-eval that wiped all scores (empty, non-
      // substantive) must not silently revoke a genuine credential (there'd be nothing to
      // reissue); leave the existing one intact in that case.
      if (!isSubstantiveSkillProfile(current) || canonicalize(current) === canonicalize(issued.profile)) {
        return { ok: true, token: issued.token, profile: issued.profile, created: false };
      }
      supersedeToken = existingRow.token;
    }
  }

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
  // Sign under the DEDICATED, versioned credential key (key_id recorded on the row) so a
  // KP_SECRET rotation never invalidates this credential; falls back to the legacy scheme
  // (key_id "") only in dev/open mode with no dedicated key configured.
  const { signature, keyId } = signNewSkillProfile(profile);
  // The PK `id` is an INTERNAL identifier — a guessable, time-ordered randomId is fine
  // because it never gates access. The PUBLIC `accessToken` handed out in the shareable
  // /skill/[token] link is a SEPARATE cryptographically-strong value (randomToken, ~192
  // bits from a CSPRNG). It is the sole auth on the credential surface, so it MUST be
  // unguessable/unenumerable — the earlier code minted it with randomId, making the
  // whole population brute-forceable (bug-ui-scan-2026-07-09 #1). "Never gates access" is
  // ENFORCED by getSkillProfileByToken/revokeSkillProfile, which accept the PK only for
  // legacy rows (access_token IS NULL); see the qualifier's comment there.
  const id = randomId("dsp");
  const accessToken = randomToken("dsp");
  // Tenant (P1): a durable skill profile inherits its submission's workspace (by-id
  // read of dev_submissions; guarded). The public lookups are by the unguessable token
  // (a candidate presents their credential to anyone) and the mint's idempotent read is
  // by the globally-unique submission_id — both exempt — so the stamp is future-proofing.
  let workspaceId = DEFAULT_WORKSPACE_ID;
  try {
    const ws = db.prepare(`SELECT workspace_id FROM dev_submissions WHERE id = ?`).get(submissionId) as { workspace_id?: string } | undefined;
    workspaceId = ws?.workspace_id ?? DEFAULT_WORKSPACE_ID;
  } catch {
    /* dev_submissions absent on this connection — keep the default workspace */
  }
  // Supersede + mint as ONE unit (IMMEDIATE, the repo's read→compute→write idiom): the
  // superseded credential is revoked only alongside the replacement that takes its place,
  // so no failure path can leave a candidate with a revoked credential and nothing to
  // present. Everything that can refuse (not evaluated / not substantive / unsignable)
  // has already run above.
  db.transaction(() => {
    if (supersedeToken) {
      db.prepare(`UPDATE skill_profiles SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL`).run(issuedAt, supersedeToken);
    }
    db.prepare(
      `INSERT INTO skill_profiles (token, access_token, submission_id, candidate_ref, case_id, profile_json, signature, version, issued_at, revoked_at, workspace_id, key_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(id, accessToken, submissionId, profile.candidateRef, profile.caseId, JSON.stringify(profile), signature, DSP_VERSION, issuedAt, workspaceId, keyId);
  }).immediate();
  // Hand back the CSPRNG access token — that is the value that goes into the public link.
  return { ok: true, token: accessToken, profile, created: true };
}

export function getSkillProfileByToken(token: string): IssuedSkillProfile | null {
  const db = store();
  // Resolve by the CSPRNG access_token (hardened credentials) OR the legacy randomId
  // PK — but the PK fallback is restricted to rows that HAVE no access_token, i.e. genuine
  // pre-hardening credentials whose already-shared links must keep verifying
  // (bug-ui-scan-2026-07-09 #1 backward-compat).
  //
  // The `access_token IS NULL` qualifier is load-bearing. Without it the PK addressed
  // EVERY row, including hardened ones — so the public credential surface still had a
  // second, Math.random()-derived, time-ordered address (`dsp-<base36 ms>-<6 base36>`),
  // and the header comment's "the PK never gates access" was not true of the code. A PK
  // guessed or predicted from other randomId values minted by the same process resolved a
  // hardened candidate's credential (name, case, axes, scores) and revoked it via
  // revokeSkillProfile, defeating the 192-bit access token entirely. Hardened rows always
  // carry an access_token, so no live link changes address.
  const r = db
    .prepare(`SELECT * FROM skill_profiles WHERE access_token = ? OR (access_token IS NULL AND token = ?)`)
    .get(token, token) as Row | undefined;
  return r ? rowToIssued(r) : null;
}

/** Verify a presented token: the stored signature must recompute under the row's OWN key
 *  (resolved by its stored key_id) AND the profile must not be revoked. This is the public
 *  "is this real?" lookup (the FICO-style trust model). Distinguishes a genuine mismatch
 *  (tamper) from missing key material (config) via `verifiable`, so a misconfigured secret
 *  never brands a real credential as fraud. */
export function verifySkillProfileToken(token: string): SkillProfileVerdict {
  const issued = getSkillProfileByToken(token);
  if (!issued) return { found: false, valid: false, revoked: false, substantive: false, verifiable: true, profile: null };
  const revoked = issued.revokedAt != null;
  const sig = checkSkillProfileSignature(issued.profile, issued.signature, issued.keyId);
  // "unconfigured" = the key material to check this row isn't available -> NOT tampered,
  // just unverifiable right now. Any other result means we could actually judge it.
  const verifiable = sig !== "unconfigured";
  const signatureOk = sig === "ok";
  // A pre-fix profile may already be empty; report substance so the page/API can show
  // a muted state instead of a confident green verdict over no content.
  const substantive = isSubstantiveSkillProfile(issued.profile);
  return { found: true, valid: signatureOk && !revoked, revoked, substantive, verifiable, profile: issued.profile };
}

export function revokeSkillProfile(token: string): boolean {
  const db = store();
  // Accept either the CSPRNG access_token or a LEGACY row's PK — same dual-address
  // contract as the public lookup, including its `access_token IS NULL` qualifier, so a
  // hardened credential can never be revoked by guessing its internal randomId PK.
  return (
    db
      .prepare(
        `UPDATE skill_profiles SET revoked_at = ? WHERE (access_token = ? OR (access_token IS NULL AND token = ?)) AND revoked_at IS NULL`
      )
      .run(new Date().toISOString(), token, token).changes > 0
  );
}
