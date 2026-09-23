// The engine's per-analysis trust ledger. Since challenge-r07 (results-core/A)
// each finding is coded at birth by its Python producer (pipeline/jobfit/trust.py):
// `trustFindings` carries {code, severity: ok|warn|blocker, scope, text, value}
// beside the unchanged `sanityChecks` sentences, and every reader here goes by
// severity/scope. The regex is the LEGACY reader for payloads saved before the
// field existed — it files "Blind screening PARTIAL … Verify manually." as a pass,
// which is why new payloads never reach it. Do not extend it; code the finding.
import type { AnalysisResult } from "./schemas.generated.ts";
import { reconcileScoreTotal } from "./format.ts";

export type TrustFinding = NonNullable<AnalysisResult["trustFindings"]>[number];

export type TrustSource = {
  sanityChecks?: readonly string[] | null;
  trustFindings?: readonly TrustFinding[] | null;
};

const WARN_MARKERS =
  /manual review|disagrees|low-confidence|outside expected range|is short|is inconsistent|unavailable|failed/i;

/** LEGACY: prose → warn?, for payloads without `trustFindings`. */
export function isSanityWarn(check: string): boolean {
  return WARN_MARKERS.test(check);
}

/** LEGACY split over bare sentences; new code reads {@link trustLedger}. */
export function splitSanityChecks(checks: readonly string[]): { warns: string[]; oks: string[] } {
  const warns: string[] = [];
  const oks: string[] = [];
  for (const check of checks) (isSanityWarn(check) ? warns : oks).push(check);
  return { warns, oks };
}

/** LEGACY count over bare sentences; new code reads {@link trustWarnCount}. */
export function countSanityWarns(checks: readonly string[]): number {
  return checks.reduce((n, check) => (isSanityWarn(check) ? n + 1 : n), 0);
}

// An empty array is a coded run with nothing to say; null means a legacy payload.
const coded = (s: TrustSource) => (Array.isArray(s.trustFindings) ? s.trustFindings : null);

/** Warn+blocker sentences vs clean ones, in ledger order: by severity when coded. */
export function trustLedger(source: TrustSource): { warns: string[]; oks: string[] } {
  const findings = coded(source);
  if (findings === null) return splitSanityChecks(source.sanityChecks ?? []);
  const warns: string[] = [];
  const oks: string[] = [];
  for (const f of findings) (f.severity === "ok" ? oks : warns).push(f.text);
  return { warns, oks };
}

/** Stamped onto `analyses.review_flags` at save time (History's flag pill). */
export function trustWarnCount(source: TrustSource): number {
  return trustLedger(source).warns.length;
}

/** True when the engine could not compute the score (a `score`-scope blocker, e.g.
 *  the section was missing and every component defaulted to 0). Legacy payloads:
 *  the one sentence pipeline.py _score_from_payload wrote for it. */
export function scoreBlocked(source: TrustSource): boolean {
  const findings = coded(source);
  if (findings !== null) return findings.some((f) => f.scope === "score" && f.severity === "blocker");
  return (source.sanityChecks ?? []).some((c) => c.startsWith("Score section missing"));
}

/** The reconciled total the dial, banner and History show — null when there is no
 *  score or it was not computed, so a defaulted 0 never reads as a measured 0. */
export function trustedScoreTotal(
  source: TrustSource & { score?: Parameters<typeof reconcileScoreTotal>[0] | null }
): number | null {
  if (!source.score || scoreBlocked(source)) return null;
  const total = reconcileScoreTotal(source.score);
  return Number.isFinite(total) ? total : null;
}

// CV authenticity band (idea-cae71d45): 0 warned → high, 1 → medium, 2+ → low.
// Mirrors pipeline/jobfit/authenticity.authenticity_band.
export const AUTHENTICITY_PREFIX = "Authenticity";

/** Null when the analysis carries no authenticity check. Coded findings count by
 *  scope + severity; the prefix + legacy regex only when `findings` is absent. */
export function authenticityBand(
  checks: readonly string[],
  findings?: readonly TrustFinding[] | null
): "high" | "medium" | "low" | null {
  const auth = Array.isArray(findings)
    ? findings.filter((f) => f.scope === "authenticity").map((f) => f.severity !== "ok")
    : checks.filter((c) => c.startsWith(AUTHENTICITY_PREFIX)).map(isSanityWarn);
  if (auth.length === 0) return null;
  const warns = auth.filter(Boolean).length;
  return warns === 0 ? "high" : warns === 1 ? "medium" : "low";
}
