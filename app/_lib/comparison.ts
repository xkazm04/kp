import { MIN_COMPARISON_VARIANTS, type Analysis } from "./schemas.ts";
import {
  SCORE_COMPONENT_KEYS,
  SCORE_COMPONENT_LABELS,
  type ScoreComponentKey
} from "./format.ts";

type ComparisonInput = { label: string; analysis: Analysis };

type ComparisonVariant = NonNullable<Analysis["comparison"]>["variants"][number];

type ComparisonPayload = NonNullable<Analysis["comparison"]>;

// Derived from the canonical score taxonomy in format.ts so the driver-insight
// component list and its prose labels can never drift from the dial/breakdown.
const COMPONENT_KEYS = SCORE_COMPONENT_KEYS;
type ComponentKey = ScoreComponentKey;

const COMPONENT_LABELS: Record<ComponentKey, string> = SCORE_COMPONENT_LABELS;

// Structured narrative shapes — derived from the persisted schema so comparison.ts
// (the producer) and CompareTab (the localizing consumer) can never disagree about
// their fields. These carry stable codes + raw params only, no display text.
export type CompareDriver = NonNullable<ComparisonPayload["driverInsightItems"]>[number];
type SectionPick = ComparisonPayload["mergedRecommendation"]["sectionPicks"][number];

/**
 * True when an analysis carries a comparison that meets the minimum-variant
 * contract (>= MIN_COMPARISON_VARIANTS). This is the SINGLE gate the UI consults:
 * ResultPanel uses it to decide whether the Compare tab exists and is the default,
 * and CompareTab uses it to choose between the comparison table and the upload
 * prompt — so the two can never disagree about what counts as "a comparison".
 * Narrows the payload to NonNullable so callers can read `.variants` afterwards.
 */
export function hasRenderableComparison(
  comparison: Analysis["comparison"] | null | undefined
): comparison is ComparisonPayload {
  return (comparison?.variants.length ?? 0) >= MIN_COMPARISON_VARIANTS;
}

export function buildComparison(inputs: ComparisonInput[]): ComparisonPayload {
  // THE minimum-variant contract (idea-38a6fd70, MIN_COMPARISON_VARIANTS): a
  // comparison only means something when it contrasts at least two variants.
  // Below that there is nothing to compare and the single-variant special cases
  // this used to carry (an "only one variant" merged summary, an empty driver
  // list) were a half-supported state, not a feature — so refuse to build one.
  // Callers (analyze-run) already branch to the single-analysis path at <2.
  if (inputs.length < MIN_COMPARISON_VARIANTS) {
    throw new Error(`buildComparison requires at least ${MIN_COMPARISON_VARIANTS} CV variants`);
  }

  // `variants` preserves UPLOAD ORDER (the map over `inputs`), NOT score rank.
  // CompareTab uses variants[0] — the FIRST CV uploaded — as the delta baseline
  // that every other column's ▲/▼ is measured against. Rank is separate: it lives
  // in `ranked`/`bestLabel` below and is surfaced as the crowned winner. Keep this
  // order stable so the baseline the UI documents stays the first-uploaded variant.
  const variants: ComparisonVariant[] = inputs.map(({ label, analysis }) => ({
    label,
    score: {
      total: analysis.score.total,
      experience: analysis.score.experience,
      skills: analysis.score.skills,
      roleSeniority: analysis.score.roleSeniority,
      education: analysis.score.education,
      traits: analysis.score.traits
    },
    jobFitScore: analysis.jobFit?.score ?? null,
    keywordCoveragePercent: analysis.keywordCoverage?.coveragePercent ?? null,
    matchingSkills: analysis.jobFit?.matchingSkills ?? [],
    missingSkills: analysis.jobFit?.missingSkills ?? [],
    strengths: analysis.strengths.slice(0, 4),
    gaps: analysis.gaps.slice(0, 4),
    skillsCount: analysis.candidate.skills.length,
    yearsExperience: analysis.candidate.yearsExperience
  }));

  const best = variants[resolveWinnerIndex(variants)];
  const bestLabel = best.label;

  const { insights: driverInsights, items: driverInsightItems } = computeDriverInsights(variants, best);
  const mergedRecommendation = buildMergedRecommendation(inputs, variants, best);

  return {
    variants,
    bestLabel,
    driverInsights,
    driverInsightItems,
    mergedRecommendation
  };
}

// THE winner-by-index rule, in one place. The winning variant is the one with the
// max `primaryScore`; a strict `>` keeps the EARLIEST column on a tie, matching the
// stable order variants are stored in. buildComparison crowns `bestLabel` with it,
// and BOTH the compare grid (which highlights a column) and the verdict banner (which
// headlines the winner) import it — so a label collision or a tie can never make the
// three surfaces disagree about who won. Returns an index (not a label) because labels
// aren't unique: two CV variants can share a filename.
export function resolveWinnerIndex(variants: ComparisonVariant[]): number {
  let winner = 0;
  for (let i = 1; i < variants.length; i++) {
    if (primaryScore(variants[i]) > primaryScore(variants[winner])) winner = i;
  }
  return winner;
}

// The single "which score ranks this variant" rule: the job-fit score when present,
// else the component total. Exported so CompareTab's winner-by-index highlight uses
// the exact same order buildComparison ranks by — the two can't crown different
// columns.
export function primaryScore(variant: ComparisonVariant): number {
  if (variant.jobFitScore != null) {
    return variant.jobFitScore;
  }
  return variant.score.total;
}

function computeDriverInsights(
  variants: ComparisonVariant[],
  best: ComparisonVariant
): { insights: string[]; items: CompareDriver[] } {
  // buildComparison guarantees >= MIN_COMPARISON_VARIANTS, so `others` is never
  // empty and there is always a real comparison to describe.
  const others = variants.filter((variant) => variant.label !== best.label);
  const insights: string[] = [];
  // The structured mirror of `insights`, built in lockstep so the localized render
  // and the English fallback describe the exact same drivers in the same order.
  const items: CompareDriver[] = [];

  const bestPrimary = primaryScore(best);
  for (const other of others) {
    const otherPrimary = primaryScore(other);
    const totalDelta = bestPrimary - otherPrimary;
    // "overall score" vs "job-fit score" is a code (CompareDriver.metric), localized
    // at render; the English word only survives in the fallback string below.
    const metric: "overall" | "jobFit" =
      best.jobFitScore != null && other.jobFitScore != null ? "jobFit" : "overall";
    const metricWord = metric === "jobFit" ? "job-fit score" : "overall score";
    if (totalDelta === 0) {
      insights.push(`"${best.label}" ties "${other.label}" on ${metricWord} (${bestPrimary.toFixed(0)}).`);
      items.push({ kind: "tie", best: best.label, other: other.label, metric, score: Math.round(bestPrimary) });
      continue;
    }
    const direction = totalDelta > 0 ? "leads" : "trails";
    insights.push(
      `"${best.label}" ${direction} "${other.label}" by ${Math.abs(totalDelta).toFixed(0)} on ${metricWord} (${bestPrimary.toFixed(0)} vs ${otherPrimary.toFixed(0)}).`
    );
    items.push({
      kind: "delta",
      best: best.label,
      other: other.label,
      dir: totalDelta > 0 ? "lead" : "trail",
      amount: Math.round(Math.abs(totalDelta)),
      metric,
      bestScore: Math.round(bestPrimary),
      otherScore: Math.round(otherPrimary)
    });

    const componentDeltas = COMPONENT_KEYS.map((key) => ({
      key,
      delta: best.score[key] - other.score[key]
    }))
      .filter((entry) => entry.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    const topDriver = componentDeltas[0];
    if (topDriver) {
      const driverDir = topDriver.delta > 0 ? "wins" : "loses";
      insights.push(
        `Driver: ${COMPONENT_LABELS[topDriver.key]} (${driverDir} ${Math.abs(topDriver.delta).toFixed(0)} pts vs "${other.label}").`
      );
      items.push({
        kind: "driver",
        component: topDriver.key,
        dir: topDriver.delta > 0 ? "win" : "loss",
        amount: Math.round(Math.abs(topDriver.delta)),
        other: other.label
      });
    }

    const skillsExclusiveToBest = (best.matchingSkills ?? []).filter(
      (skill) => !(other.matchingSkills ?? []).includes(skill)
    );
    const skillsExclusiveToOther = (other.matchingSkills ?? []).filter(
      (skill) => !(best.matchingSkills ?? []).includes(skill)
    );
    if (skillsExclusiveToBest.length) {
      const skills = skillsExclusiveToBest.slice(0, 4);
      insights.push(`"${best.label}" surfaces unique matches: ${skills.join(", ")}.`);
      items.push({ kind: "uniqueBest", best: best.label, skills });
    }
    if (skillsExclusiveToOther.length) {
      const skills = skillsExclusiveToOther.slice(0, 4);
      insights.push(`"${other.label}" still proves: ${skills.join(", ")} — worth merging into the winner.`);
      items.push({ kind: "uniqueOther", other: other.label, skills });
    }
  }

  // Cap both views identically so the localized render and the fallback stay aligned.
  return { insights: insights.slice(0, 8), items: items.slice(0, 8) };
}

function buildMergedRecommendation(
  inputs: ComparisonInput[],
  variants: ComparisonVariant[],
  best: ComparisonVariant
): ComparisonPayload["mergedRecommendation"] {
  const byLabel = new Map(inputs.map((input) => [input.label, input.analysis] as const));
  const bestAnalysis = byLabel.get(best.label);

  const sectionPicks: SectionPick[] = [];

  const headlinePick = pickByMaxComponent(variants, "roleSeniority");
  const summaryPick = pickByMaxComponent(variants, "experience");
  const bulletsPick = best;
  const skillsPick = pickByMaxComponent(variants, "skills");

  // `section` (English label) + `reason` (English sentence) stay for the fallback;
  // `key` + `reasonParams` are the structured pair CompareTab localizes at render.
  sectionPicks.push({
    section: "Headline",
    key: "headline",
    sourceLabel: headlinePick.label,
    reason: `Top role-seniority signal (${headlinePick.score.roleSeniority.toFixed(0)} pts).`,
    reasonParams: { pts: Math.round(headlinePick.score.roleSeniority) }
  });
  sectionPicks.push({
    section: "Summary",
    key: "summary",
    sourceLabel: summaryPick.label,
    reason: `Strongest experience framing (${summaryPick.score.experience.toFixed(0)} pts, ${summaryPick.yearsExperience} yrs surfaced).`,
    reasonParams: { pts: Math.round(summaryPick.score.experience), yrs: summaryPick.yearsExperience }
  });
  sectionPicks.push({
    section: "Bullets",
    key: "bullets",
    sourceLabel: bulletsPick.label,
    reason: `Highest overall fit (${primaryScore(bulletsPick).toFixed(0)}).`,
    reasonParams: { score: Math.round(primaryScore(bulletsPick)) }
  });
  sectionPicks.push({
    section: "Skills line",
    key: "skillsLine",
    sourceLabel: skillsPick.label,
    reason: `Best skills coverage (${skillsPick.score.skills.toFixed(0)} pts, ${skillsPick.skillsCount} skills indexed).`,
    reasonParams: { pts: Math.round(skillsPick.score.skills), count: skillsPick.skillsCount }
  });

  const headlineCandidate =
    byLabel.get(headlinePick.label)?.candidate ?? bestAnalysis?.candidate;
  // Keep the English `headline` string for the fallback, but also emit the enum slugs
  // (seniority/roleFamily) + skills so CompareTab renders the words through the
  // localized enum catalog instead of the analysis-time English slug words.
  const headlineParams = headlineCandidate
    ? {
        seniority: headlineCandidate.currentSeniority,
        roleFamily: headlineCandidate.roleFamily,
        skills: headlineCandidate.skills.slice(0, 3)
      }
    : null;
  const headline = headlineParams
    ? `${headlineParams.seniority.replace("_", " ")} ${headlineParams.roleFamily.replace("_", " ")} — ${headlineParams.skills.join(", ")}`
    : "";
  const skillsLine = (byLabel.get(skillsPick.label)?.candidate.skills ?? []).slice(0, 12).join(" • ");

  const bullets = mergeBestBullets(inputs, variants);

  const summaryKind: "allSame" | "split" =
    new Set(sectionPicks.map((pick) => pick.sourceLabel)).size === 1 ? "allSame" : "split";

  return {
    summary: buildMergedSummary(best, sectionPicks),
    summaryKind,
    headline,
    headlineParams,
    skillsLine,
    bullets,
    sectionPicks
  };
}

function pickByMaxComponent(variants: ComparisonVariant[], key: ComponentKey): ComparisonVariant {
  return [...variants].sort((a, b) => b.score[key] - a.score[key])[0];
}

function mergeBestBullets(inputs: ComparisonInput[], variants: ComparisonVariant[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  const ordered = [...variants].sort((a, b) => primaryScore(b) - primaryScore(a));
  // Pull bullets from interviewTalkingPoints (when JD-bound) or strengths (otherwise);
  // both surface concrete evidence the candidate could lead a CV rewrite with.
  const bulletsByLabel = new Map(
    inputs.map(
      (input) =>
        [
          input.label,
          [
            ...(input.analysis.jobFit?.interviewTalkingPoints ?? []),
            ...input.analysis.strengths,
          ],
        ] as const
    )
  );

  for (const variant of ordered) {
    const bullets = bulletsByLabel.get(variant.label) ?? [];
    for (const bullet of bullets) {
      const key = bullet.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(bullet);
      if (merged.length >= 6) break;
    }
    if (merged.length >= 6) break;
  }
  return merged;
}

function buildMergedSummary(
  best: ComparisonVariant,
  picks: ComparisonPayload["mergedRecommendation"]["sectionPicks"]
): string {
  // Reaches here only with >= MIN_COMPARISON_VARIANTS (buildComparison's
  // contract), so there is always more than one variant's sections to weigh.
  const distinct = new Set(picks.map((pick) => pick.sourceLabel));
  if (distinct.size === 1) {
    return `"${best.label}" wins every section. Send that variant as-is.`;
  }
  const splits = picks.map((pick) => `${pick.section.toLowerCase()} from "${pick.sourceLabel}"`).join(", ");
  return `Best merged variant pulls ${splits}. Start from "${best.label}" and graft the strongest sections from the others.`;
}
