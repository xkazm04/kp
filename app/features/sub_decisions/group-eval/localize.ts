import type { GroupEvalPayload, RiskFact } from "./types";

// eval-speaks-your-language — turn the eval's PERSISTED STRUCTURED FACTS into
// sentences in the reader's language.
//
// A group eval is generated once and re-opened by anyone on the team, so every
// sentence baked into the payload is frozen in whatever language produced it.
// The server therefore persists facts (RiskFact / SummaryFacts / governanceMode /
// leadSeparation / topPick.whyKind) and this module composes the copy through the
// `decisions.groupEval.*` catalog at render time.
//
// LEGACY payloads (saved before the facts existed) carry only the English prose.
// Every function here falls back to that stored prose verbatim: an old eval keeps
// rendering exactly as it did, rather than losing its content to a missing fact.
//
// Pure + React-free (it takes a translate function, not a hook) so it unit-tests
// under bare `node --test`.

/** The minimal translate surface these composers need — structurally satisfied by
 *  a next-intl `useTranslations("decisions.groupEval")` translator (whose own key
 *  type is narrower, so call sites pass it through one cast). */
export type Translate = (key: string, params?: Record<string, string | number | Date>) => string;

const isRiskFact = (r: string | RiskFact): r is RiskFact => typeof r === "object" && r !== null;

/** One watch-out line. A legacy string risk is returned verbatim. */
export function riskText(t: Translate, risk: string | RiskFact): string {
  if (!isRiskFact(risk)) return risk;
  if (risk.kind === "low_fit") return t("risk.lowFit", { label: risk.label, score: risk.score });
  if (risk.kind === "early_career") return t("risk.earlyCareer", { label: risk.label });
  return t("risk.gaps", { label: risk.label, gaps: risk.gaps.join(", ") });
}

/** "Alice (fit 82)" / "Alice (unscored)" — the lead as named in the summary. An
 *  unscored lead must never be rendered with a fabricated number (REC-03). */
function leadDesc(t: Translate, label: string, score: number | null | undefined): string {
  return score == null ? t("summary.leadUnscored", { label }) : t("summary.leadScored", { label, score });
}

/** The deterministic summary sentence(s). Returns the legacy English prose when
 *  the payload predates `summaryFacts`, and undefined when there is neither. */
export function summaryText(t: Translate, evaluation: GroupEvalPayload): string | undefined {
  const facts = evaluation.summaryFacts;
  if (!facts) return evaluation.summary;
  const parts: string[] = [];
  const base = { count: facts.count, role: facts.roleTitle };
  const lead = facts.leadLabel ? leadDesc(t, facts.leadLabel, facts.leadScore) : "";
  switch (facts.kind) {
    case "empty":
      parts.push(t("summary.empty", { role: facts.roleTitle }));
      break;
    case "insufficient":
      parts.push(t("summary.insufficient", base));
      break;
    case "no_lead":
      parts.push(t("summary.noLead", base));
      break;
    case "eligibility":
      parts.push(t("summary.eligibility", { ...base, lead }));
      break;
    case "committee":
      parts.push(t("summary.committee", { ...base, lead }));
      if (facts.riskCount) parts.push(t("summary.watchOuts", { count: facts.riskCount }));
      break;
    case "recommendation":
      parts.push(t("summary.recommendation", { ...base, lead }));
      if (facts.differentiators?.length) parts.push(t("summary.uniqueStrengths", { list: facts.differentiators.join(", ") }));
      parts.push(facts.riskCount ? t("summary.watchOuts", { count: facts.riskCount }) : t("summary.noRisks"));
      break;
  }
  // The confidence hedge rides wherever the crown is stated — same rule the sealed
  // English rationale follows (group-eval-separation.separationNote).
  if (facts.separation?.verdict === "overlapping") {
    parts.push(
      t("summary.separationCaveat", { lead: facts.separation.leadLabel, runnerUp: facts.separation.runnerUpLabel })
    );
  }
  return parts.join(" ");
}

/** The compliance-critical governance banner. Composed from the persisted MODE
 *  (an enum, present since P1-3); only a payload without one falls back to the
 *  stored English note. */
export function governanceText(t: Translate, evaluation: GroupEvalPayload): string | null {
  const mode = evaluation.governanceMode;
  if (mode === "recommendation") return null;
  if (mode === "committee") return t("governance.committee");
  if (mode === "eligibility_list") return t("governance.eligibilityList");
  return evaluation.governanceNote ?? null;
}

/** The lead's "why". An AI verdict (already generated in the org locale) and a
 *  legacy payload render their stored prose; a server fallback renders localized. */
export function topPickWhyText(t: Translate, topPick: GroupEvalPayload["topPick"]): string {
  if (!topPick) return "";
  if (topPick.whyKind === "highest_fit") return t("topPickWhy.highestFit", { score: topPick.score ?? 0 });
  if (topPick.whyKind === "unscored") return t("topPickWhy.unscored");
  return topPick.why ?? "";
}
