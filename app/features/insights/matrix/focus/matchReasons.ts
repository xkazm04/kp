// The plain-language reasons line for ONE match result (key goal 4: no ranking
// leaves the product without a reasons block). Two halves, both pure and
// deterministic, no LLM and no network:
//
//   * matchReasonFacts(m) reads only the result's own fields — fit tier, strongest/
//     weakest score dimension, a few skill names, the total — into locale-free FACTS
//     (MatchReasonFacts, app/_lib/match-verdict.ts). That is what a Match add sends and
//     what the route seals into the decision chain (ADR 0018), never a sentence.
//   * renderMatchReasons(facts, t) turns facts into the line, every word from the
//     `match` catalog through the translator it is handed (the ReasonsCatalog pattern in
//     app/_lib/reasons-coverage.ts). The Match card, the CSV, the Decisions cohort and
//     the reasons meter all render through it, so a sealed record reads the same in
//     every place and in every reader's language.
//
// "Explain fit" stays the optional deeper, model-written layer.
import type { MatchResult, ScoreDimension } from "@/app/features/shared/matchTypes";
import {
  isDimensionLabelCode,
  MATCH_FACTS_MAX_SKILLS,
  MATCH_FACTS_SKILL_MAX_CHARS,
  type MatchReasonDimension,
  type MatchReasonFacts,
} from "@/app/_lib/match-verdict";

/** A translator scoped to the `match` namespace, read loosely because the keys it
 *  resolves (`dims.<code>`) are dynamic. `has` is optional so a test can pass a bare
 *  function; without it every dimension code is looked up directly (the codes are a
 *  closed vocabulary the catalog covers — matchReasons.test.ts pins that). */
export type MatchReasonsTranslator = {
  (key: string, values?: Record<string, string | number>): string;
  has?: (key: string) => boolean;
};

/** The version of the scorer whose output the facts describe, sealed as the record's
 *  `policyVersion`. No version travels with a /api/match result today (the Python
 *  scorer does not emit one), so this names the facts contract the client builds;
 *  bump it when matchReasonFacts or the scorer's tier/dimension semantics change. */
export const MATCH_SCORER_VERSION = "match-scorer.v1";

/** The renderer's bound on one line. */
export const MATCH_REASONS_MAX_CHARS = 600;

/** A rendered reasons line plus the skill lists it names. */
export type MatchReasons = { line: string; matched: string[]; unproven: string[]; missing: string[] };

function pickSkills(list: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of list ?? []) {
    if (typeof raw !== "string") continue;
    const s = raw.trim().slice(0, MATCH_FACTS_SKILL_MAX_CHARS).trim();
    if (s && !out.includes(s)) out.push(s);
    if (out.length === MATCH_FACTS_MAX_SKILLS) break;
  }
  return out;
}

/** The dimension as the facts quote it, or null when it cannot be quoted: a non-finite
 *  or out-of-range percent, or no slug in the closed vocabulary (labelCode, else key). */
function quotedDimension(d: ScoreDimension | undefined): MatchReasonDimension | null {
  if (!d || !Number.isFinite(d.percent)) return null;
  const labelCode = isDimensionLabelCode(d.labelCode) ? d.labelCode : isDimensionLabelCode(d.key) ? d.key : null;
  const percent = Math.round(d.percent);
  if (!labelCode || percent < 0 || percent > 100) return null;
  return { labelCode, percent };
}

/** The facts behind one result's reasons line. Always returns facts — whether they say
 *  anything is the renderer's call — so every Match add seals a verdict, including one
 *  that cannot explain itself (the meter then names it as a miss). `matchScore` follows
 *  matchScoreForPipeline: a finite total, else null. */
export function matchReasonFacts(m: MatchResult): MatchReasonFacts {
  const dims = (m.scoreBreakdown ?? [])
    .map((d) => ({ d, q: quotedDimension(d) }))
    .filter((x): x is { d: ScoreDimension; q: MatchReasonDimension } => x.q !== null)
    .sort((a, b) => b.d.percent - a.d.percent);
  return {
    fitTier: m.fitTier ?? null,
    best: dims.length > 0 ? dims[0].q : null,
    worst: dims.length > 1 ? dims[dims.length - 1].q : null,
    matched: pickSkills(m.matchedSkills),
    unproven: pickSkills(m.unprovenSkills),
    missing: pickSkills(m.missingSkills),
    matchScore: typeof m.total === "number" && Number.isFinite(m.total) ? m.total : null,
    scorerVersion: MATCH_SCORER_VERSION,
  };
}

/** The reasons line for a set of facts, or null when there is neither a dimension nor
 *  any skill name — facts that cannot say why are never given a filler sentence. */
export function renderMatchReasons(facts: MatchReasonFacts, t: MatchReasonsTranslator): MatchReasons | null {
  const { best, worst, matched, unproven, missing } = facts;
  if (!best && matched.length + unproven.length + missing.length === 0) return null;

  const tier = facts.fitTier ? t(`fitTier.${facts.fitTier}`) : "";
  const dimName = (d: MatchReasonDimension) => {
    const key = `dims.${d.labelCode}`;
    return !t.has || t.has(key) ? t(key) : d.labelCode;
  };

  const sentences: string[] = [];
  const withTier = tier !== "";
  if (best && worst) {
    sentences.push(
      t(withTier ? "reasons.headlineRangeTier" : "reasons.headlineRange", {
        tier,
        best: dimName(best),
        bestPercent: best.percent,
        worst: dimName(worst),
        worstPercent: worst.percent,
      })
    );
  } else if (best) {
    sentences.push(t(withTier ? "reasons.headlineOneTier" : "reasons.headlineOne", { tier, best: dimName(best), bestPercent: best.percent }));
  } else if (withTier) {
    sentences.push(t("reasons.headlineTier", { tier }));
  }

  const parts: string[] = [];
  if (matched.length > 0) parts.push(t("reasons.skillsMatched", { skills: matched.join(", ") }));
  if (unproven.length > 0) parts.push(t("reasons.skillsUnproven", { skills: unproven.join(", ") }));
  if (missing.length > 0) parts.push(t("reasons.skillsMissing", { skills: missing.join(", ") }));
  if (parts.length > 0) sentences.push(t("reasons.skillsSentence", { parts: parts.join("; ") }));

  const line = sentences.join(" ").slice(0, MATCH_REASONS_MAX_CHARS).trim();
  if (!line) return null;
  return { line, matched, unproven, missing };
}

/** The reasons for one result: its facts, rendered. What the Match card and the CSV show. */
export function matchReasons(m: MatchResult, t: MatchReasonsTranslator): MatchReasons | null {
  return renderMatchReasons(matchReasonFacts(m), t);
}
