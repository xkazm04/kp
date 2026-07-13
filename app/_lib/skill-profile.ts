import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalize } from "./decision-hash.ts";

// Durable Skill Profile (moonshot A flagship) — a portable, candidate-owned,
// cryptographically-attested credential minted from a graded dev-case. It freezes
// the durable capability axes + transfer score + the PROPAGATED confidence into a
// versioned artifact and HMAC-signs it (over the canonical form, reusing the
// decision-chain canonicalizer) so kp can verify a presented credential is exactly
// what it issued. Symmetric (HMAC) → verification is kp-hosted (the "FICO lookup"
// trust model); offline/asymmetric verification is a follow-up.

export const DSP_VERSION = "dsp-v1";

export type DurableSkillProfile = {
  version: string; // DSP_VERSION — bump when the artifact shape or methodology changes
  candidateRef: string;
  caseId: string | null;
  issuedAt: string; // ISO
  axes: Record<string, number>; // durable capability axes, name -> SCORE 0..100
  transferScore: number; // SCORE 0..100
  confidence: number; // FRACTION 0..1 — propagated (min of upstream reflection/tooling)
  methodologyVersion: string;
};

function clampScore(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 100 ? 100 : x;
}
function clampFraction(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Structural input (no DevTypes import) so this module stays a pure, testable leaf.
export type EvalForProfile = {
  evaluation?: { dimensionScores?: Record<string, number> | null; confidence?: number | null } | null;
  transfer?: { transferScore?: number | null } | null;
};

export function buildDurableSkillProfile(input: {
  candidateRef: string;
  caseId: string | null;
  issuedAt: string;
  eval: EvalForProfile;
}): DurableSkillProfile {
  const axesRaw = input.eval.evaluation?.dimensionScores ?? {};
  const axes: Record<string, number> = {};
  for (const [k, v] of Object.entries(axesRaw)) {
    if (typeof v === "number" && Number.isFinite(v)) axes[k] = clampScore(v);
  }
  return {
    version: DSP_VERSION,
    candidateRef: input.candidateRef,
    caseId: input.caseId ?? null,
    issuedAt: input.issuedAt,
    axes,
    transferScore: clampScore(Number(input.eval.transfer?.transferScore ?? 0)),
    confidence: clampFraction(Number(input.eval.evaluation?.confidence ?? 0)),
    methodologyVersion: DSP_VERSION,
  };
}

/** Whether a built profile carries actual graded SUBSTANCE — at least one capability
 *  axis OR a non-zero transfer score. The HMAC attests INTEGRITY (untampered), not
 *  substance: an evaluation bundle with no dimension scores yields axes={} + score 0,
 *  a validly-SIGNED but EMPTY credential. Callers must not mint or present such a
 *  profile as a confident "verified" attestation (a green shield over a score of 0,
 *  no axes). Pure + testable (skill-profile.test.ts). */
export function isSubstantiveSkillProfile(dsp: { axes: Record<string, number>; transferScore: number }): boolean {
  return Object.keys(dsp.axes).length > 0 || dsp.transferScore > 0;
}

// bug-ui-scan-2026-07-09 (skill-matrix-coverage #3): a "durable" credential has
// revocation but no freshness dimension — the green "Verified" shield reads identically
// for a week-old and a five-year-old attestation, and for a superseded methodology. The
// HMAC only attests INTEGRITY (untampered bytes); it says nothing about whether the
// assessment is still CURRENT. `skillProfileFreshness` adds that missing dimension so the
// page can downgrade a stale credential to a muted, honest "issued a while ago" state
// instead of over-asserting freshness. Freshness is derived from the already-signed
// `issuedAt` + `methodologyVersion` — NO new signed field — so existing credentials keep
// verifying and outstanding /skill links never break.
export const PROFILE_FRESHNESS_DAYS = 730; // ~2 years before "Verified" is downgraded to "stale"

export type SkillProfileFreshness = {
  ageDays: number | null; // whole days since issue; null when issuedAt is unparseable
  ageYears: number | null; // ageDays / 365 to one decimal; null when unknown
  stale: boolean; // past the validity window OR signed under a superseded methodology
  reason: "age" | "methodology" | null;
};

/** Freshness of an issued profile relative to `nowMs`. STALE when it was issued more than
 *  `windowDays` ago, or when its methodologyVersion is not the current DSP_VERSION (a
 *  superseded scoring standard). Integrity is orthogonal — a stale profile is still
 *  untampered, just no longer *current* — so callers downgrade the badge to a neutral
 *  "issued N years ago" rather than a confident green shield. Pure + testable. */
export function skillProfileFreshness(
  dsp: { issuedAt: string; methodologyVersion?: string },
  nowMs: number,
  windowDays: number = PROFILE_FRESHNESS_DAYS,
): SkillProfileFreshness {
  const methodologyStale = (dsp.methodologyVersion ?? DSP_VERSION) !== DSP_VERSION;
  const issuedMs = Date.parse(dsp.issuedAt);
  if (!Number.isFinite(issuedMs)) {
    // Unparseable issue date — can't age it, so only a methodology bump can mark it stale.
    return { ageDays: null, ageYears: null, stale: methodologyStale, reason: methodologyStale ? "methodology" : null };
  }
  const ageDays = Math.max(0, Math.floor((nowMs - issuedMs) / 86_400_000));
  const ageYears = Math.round((ageDays / 365) * 10) / 10;
  const ageStale = ageDays > windowDays;
  // Age is the caption-driving reason when present; a methodology bump on an otherwise
  // fresh profile still marks it stale (reason "methodology").
  const reason: SkillProfileFreshness["reason"] = ageStale ? "age" : methodologyStale ? "methodology" : null;
  return { ageDays, ageYears, stale: ageStale || methodologyStale, reason };
}

/** Freshness as of NOW. Thin wrapper that supplies the wall clock, so the impure
 *  `Date.now()` read stays OUT of the server-component render body (the React purity
 *  rule). The pure, injectable {@link skillProfileFreshness} is the tested core. */
export function skillProfileFreshnessNow(dsp: { issuedAt: string; methodologyVersion?: string }): SkillProfileFreshness {
  return skillProfileFreshness(dsp, Date.now());
}

function signingKey(): string {
  const secret = process.env.KP_SECRET;
  if (!secret) {
    throw new Error("KP_SECRET is not set — required to sign Durable Skill Profiles.");
  }
  return secret;
}

/** HMAC-SHA256 over the canonical form of the profile. Deterministic for a given
 *  (profile, KP_SECRET); any field change or a rotated secret produces a different
 *  signature — that's the attestation. */
export function signProfile(dsp: DurableSkillProfile): string {
  return createHmac("sha256", signingKey()).update(canonicalize(dsp)).digest("hex");
}

/** Constant-time verify that `signature` is kp's signature over `dsp` under the
 *  current KP_SECRET. False on any mismatch (tamper, rotated secret, garbage). */
export function verifyProfile(dsp: DurableSkillProfile, signature: string): boolean {
  let expected: string;
  try {
    expected = signProfile(dsp);
  } catch {
    return false;
  }
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(typeof signature === "string" ? signature : "", "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
