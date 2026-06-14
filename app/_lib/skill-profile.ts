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
