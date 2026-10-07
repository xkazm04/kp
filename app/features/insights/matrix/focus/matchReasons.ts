// The plain-language reasons line for ONE match result (key goal 4: no ranking
// leaves the product without a reasons block). Pure and deterministic: it reads
// only the result's own fields — fit tier, strongest/weakest score dimension, a few
// skill names — and every word comes from the `match` catalog through the
// translator it is handed (the ReasonsCatalog pattern in app/_lib/reasons-coverage.ts).
// No LLM, no network. "Explain fit" stays the optional deeper, model-written layer.
import type { MatchResult, ScoreDimension } from "@/app/features/shared/matchTypes";

/** A translator scoped to the `match` namespace, read loosely because the keys it
 *  resolves (`dims.<code>`) are dynamic. `has` is optional so a test can pass a bare
 *  function; without it a dimension falls back to its server `label`. */
export type MatchReasonsTranslator = {
  (key: string, values?: Record<string, string | number>): string;
  has?: (key: string) => boolean;
};

const MAX_SKILLS = 3;
const MAX_SKILL_CHARS = 40;
/** The pipeline route's bound on a carried reasons line. */
export const MATCH_REASONS_MAX_CHARS = 600;

/** The structured half of a reasons line: what the pipeline snapshot stores. */
export type MatchReasons = { line: string; matched: string[]; unproven: string[]; missing: string[] };

function pickSkills(list: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of list ?? []) {
    if (typeof raw !== "string") continue;
    const s = raw.trim().slice(0, MAX_SKILL_CHARS);
    if (s && !out.includes(s)) out.push(s);
    if (out.length === MAX_SKILLS) break;
  }
  return out;
}

function usableDims(dims: readonly ScoreDimension[] | undefined): ScoreDimension[] {
  return (dims ?? []).filter((d) => d && Number.isFinite(d.percent));
}

/** The reasons for one result, or null when it has neither a usable breakdown nor
 *  any skill list — a result that cannot say why is never given a filler sentence. */
export function matchReasons(m: MatchResult, t: MatchReasonsTranslator): MatchReasons | null {
  const dims = usableDims(m.scoreBreakdown);
  const matched = pickSkills(m.matchedSkills);
  const unproven = pickSkills(m.unprovenSkills);
  const missing = pickSkills(m.missingSkills);
  if (dims.length === 0 && matched.length + unproven.length + missing.length === 0) return null;

  const tier = m.fitTier ? t(`fitTier.${m.fitTier}`) : "";
  const dimName = (d: ScoreDimension) =>
    d.labelCode && t.has?.(`dims.${d.labelCode}`) ? t(`dims.${d.labelCode}`) : d.label;

  const sentences: string[] = [];
  if (dims.length > 0) {
    const sorted = [...dims].sort((a, b) => b.percent - a.percent);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const withTier = tier !== "";
    if (dims.length === 1) {
      sentences.push(
        t(withTier ? "reasons.headlineOneTier" : "reasons.headlineOne", {
          tier,
          best: dimName(best),
          bestPercent: Math.round(best.percent),
        })
      );
    } else {
      sentences.push(
        t(withTier ? "reasons.headlineRangeTier" : "reasons.headlineRange", {
          tier,
          best: dimName(best),
          bestPercent: Math.round(best.percent),
          worst: dimName(worst),
          worstPercent: Math.round(worst.percent),
        })
      );
    }
  } else if (tier) {
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
