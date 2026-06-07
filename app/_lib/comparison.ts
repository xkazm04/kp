import { MIN_COMPARISON_VARIANTS, type Analysis } from "./schemas.ts";

type ComparisonInput = { label: string; analysis: Analysis };

type ComparisonVariant = NonNullable<Analysis["comparison"]>["variants"][number];

type ComparisonPayload = NonNullable<Analysis["comparison"]>;

const COMPONENT_KEYS = ["experience", "skills", "roleSeniority", "education", "traits"] as const;
type ComponentKey = (typeof COMPONENT_KEYS)[number];

const COMPONENT_LABELS: Record<ComponentKey, string> = {
  experience: "experience",
  skills: "skills",
  roleSeniority: "role seniority",
  education: "education",
  traits: "traits"
};

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

  const ranked = [...variants].sort((a, b) => primaryScore(b) - primaryScore(a));
  const best = ranked[0];
  const bestLabel = best.label;

  const driverInsights = computeDriverInsights(variants, best);
  const mergedRecommendation = buildMergedRecommendation(inputs, variants, best);

  return {
    variants,
    bestLabel,
    driverInsights,
    mergedRecommendation
  };
}

function primaryScore(variant: ComparisonVariant): number {
  if (variant.jobFitScore != null) {
    return variant.jobFitScore;
  }
  return variant.score.total;
}

function computeDriverInsights(variants: ComparisonVariant[], best: ComparisonVariant): string[] {
  // buildComparison guarantees >= MIN_COMPARISON_VARIANTS, so `others` is never
  // empty and there is always a real comparison to describe.
  const others = variants.filter((variant) => variant.label !== best.label);
  const insights: string[] = [];

  const bestPrimary = primaryScore(best);
  for (const other of others) {
    const otherPrimary = primaryScore(other);
    const totalDelta = bestPrimary - otherPrimary;
    const tag = best.jobFitScore != null && other.jobFitScore != null ? "job-fit score" : "overall score";
    if (totalDelta === 0) {
      insights.push(`"${best.label}" ties "${other.label}" on ${tag} (${bestPrimary.toFixed(0)}).`);
      continue;
    }
    const direction = totalDelta > 0 ? "leads" : "trails";
    insights.push(
      `"${best.label}" ${direction} "${other.label}" by ${Math.abs(totalDelta).toFixed(0)} on ${tag} (${bestPrimary.toFixed(0)} vs ${otherPrimary.toFixed(0)}).`
    );

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
    }

    const skillsExclusiveToBest = (best.matchingSkills ?? []).filter(
      (skill) => !(other.matchingSkills ?? []).includes(skill)
    );
    const skillsExclusiveToOther = (other.matchingSkills ?? []).filter(
      (skill) => !(best.matchingSkills ?? []).includes(skill)
    );
    if (skillsExclusiveToBest.length) {
      insights.push(
        `"${best.label}" surfaces unique matches: ${skillsExclusiveToBest.slice(0, 4).join(", ")}.`
      );
    }
    if (skillsExclusiveToOther.length) {
      insights.push(
        `"${other.label}" still proves: ${skillsExclusiveToOther.slice(0, 4).join(", ")} — worth merging into the winner.`
      );
    }
  }

  return insights.slice(0, 8);
}

function buildMergedRecommendation(
  inputs: ComparisonInput[],
  variants: ComparisonVariant[],
  best: ComparisonVariant
): ComparisonPayload["mergedRecommendation"] {
  const byLabel = new Map(inputs.map((input) => [input.label, input.analysis] as const));
  const bestAnalysis = byLabel.get(best.label);

  const sectionPicks: ComparisonPayload["mergedRecommendation"]["sectionPicks"] = [];

  const headlinePick = pickByMaxComponent(variants, "roleSeniority");
  const summaryPick = pickByMaxComponent(variants, "experience");
  const bulletsPick = best;
  const skillsPick = pickByMaxComponent(variants, "skills");

  sectionPicks.push({
    section: "Headline",
    sourceLabel: headlinePick.label,
    reason: `Top role-seniority signal (${headlinePick.score.roleSeniority.toFixed(0)} pts).`
  });
  sectionPicks.push({
    section: "Summary",
    sourceLabel: summaryPick.label,
    reason: `Strongest experience framing (${summaryPick.score.experience.toFixed(0)} pts, ${summaryPick.yearsExperience} yrs surfaced).`
  });
  sectionPicks.push({
    section: "Bullets",
    sourceLabel: bulletsPick.label,
    reason: `Highest overall fit (${primaryScore(bulletsPick).toFixed(0)}).`
  });
  sectionPicks.push({
    section: "Skills line",
    sourceLabel: skillsPick.label,
    reason: `Best skills coverage (${skillsPick.score.skills.toFixed(0)} pts, ${skillsPick.skillsCount} skills indexed).`
  });

  const headlineCandidate =
    byLabel.get(headlinePick.label)?.candidate ?? bestAnalysis?.candidate;
  const headline = headlineCandidate
    ? `${headlineCandidate.currentSeniority.replace("_", " ")} ${headlineCandidate.roleFamily.replace("_", " ")} — ${headlineCandidate.skills.slice(0, 3).join(", ")}`
    : "";
  const skillsLine = (byLabel.get(skillsPick.label)?.candidate.skills ?? []).slice(0, 12).join(" • ");

  const bullets = mergeBestBullets(inputs, variants);

  return {
    summary: buildMergedSummary(best, sectionPicks),
    headline,
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
