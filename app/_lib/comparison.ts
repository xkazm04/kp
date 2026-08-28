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

/** The ranking/narrative axis code, derived from the persisted schema's
 *  `compareMetricSchema` so the axis this module ranks on and the code CompareTab
 *  localizes can never drift apart. */
export type CompareMetric = Extract<CompareDriver, { kind: "delta" }>["metric"];

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

  // INDEX, not label, is the identity everywhere below: labels aren't unique (two
  // CV variants can share a filename), so keying the driver narrative or the merged
  // recommendation by label silently drops a real column or attributes one CV's
  // content to another (analysis-result-panels #1). variants and inputs are the same
  // list in the same order, so the winner index addresses both.
  const winnerIndex = resolveWinnerIndex(variants);
  const bestLabel = variants[winnerIndex].label;

  const { insights: driverInsights, items: driverInsightItems } = computeDriverInsights(variants, winnerIndex);
  const mergedRecommendation = buildMergedRecommendation(inputs, variants, winnerIndex);

  return {
    variants,
    bestLabel,
    driverInsights,
    driverInsightItems,
    mergedRecommendation
  };
}

// THE winner-by-index rule, in one place. The winning variant is the one with the
// max `primaryScore` ON THE COHORT'S SHARED AXIS (see comparisonMetric); a strict `>`
// keeps the EARLIEST column on a tie, matching the stable order variants are stored
// in. buildComparison crowns `bestLabel` with it, and BOTH the compare grid (which
// highlights a column) and the verdict banner (which headlines the winner) import it —
// so a label collision or a tie can never make the three surfaces disagree about who
// won. Returns an index (not a label) because labels aren't unique: two CV variants
// can share a filename.
export function resolveWinnerIndex(variants: ComparisonVariant[]): number {
  const metric = comparisonMetric(variants);
  let winner = 0;
  for (let i = 1; i < variants.length; i++) {
    if (primaryScore(variants[i], metric) > primaryScore(variants[winner], metric)) winner = i;
  }
  return winner;
}

/** THE axis a whole cohort of variants is ranked and narrated on.
 *
 *  Job-fit is the sharper signal, but it is a DIFFERENT 0-100 producer than the
 *  component total, and `jobFit` is nullish per analysis (`schemas.generated.ts`):
 *  each variant is an independent engine call, so a JD-bound multi-CV run can come
 *  back with a job-fit read for one variant and none for another. Picking the axis
 *  PER VARIANT then ranked one CV's job-fit against another's component total — two
 *  incomparable scales — and labelled the mixed pair "overall score": a variant with
 *  jobFit 82 / total 55 was crowned over a variant with total 74, and the driver line
 *  read `leads by 8 on overall score (82 vs 74)` where the leader's overall is 55.
 *  The axis is therefore resolved ONCE for the cohort: job-fit only when EVERY
 *  variant carries one, else the component total every variant always has. */
export function comparisonMetric(variants: ComparisonVariant[]): CompareMetric {
  return variants.length > 0 && variants.every((v) => v.jobFitScore != null) ? "jobFit" : "overall";
}

// The single "which score ranks this variant" rule, read on the cohort's shared axis
// (`comparisonMetric`). Exported so CompareTab's winner-by-index highlight uses the
// exact same order buildComparison ranks by — the two can't crown different columns.
export function primaryScore(variant: ComparisonVariant, metric: CompareMetric): number {
  // The `?? score.total` is unreachable under a "jobFit" metric (comparisonMetric
  // only returns it when every variant has a read) — it exists so a hand-built
  // caller can never mint a number out of an absent job-fit.
  return metric === "jobFit" ? variant.jobFitScore ?? variant.score.total : variant.score.total;
}

function computeDriverInsights(
  variants: ComparisonVariant[],
  winnerIndex: number
): { insights: string[]; items: CompareDriver[] } {
  const best = variants[winnerIndex];
  // buildComparison guarantees >= MIN_COMPARISON_VARIANTS, so `others` is never
  // empty. Filter by INDEX, not label: a distinct variant that happens to share the
  // winner's filename must still appear in the driver narrative (was excluded by the
  // old `label !== best.label` filter).
  const others = variants.filter((_, i) => i !== winnerIndex);
  const insights: string[] = [];
  // The structured mirror of `insights`, built in lockstep so the localized render
  // and the English fallback describe the exact same drivers in the same order.
  const items: CompareDriver[] = [];

  // "overall score" vs "job-fit score" is a code (CompareDriver.metric), localized
  // at render; the English word only survives in the fallback string below. Resolved
  // ONCE for the cohort — the same axis the winner was crowned on — so the reported
  // numbers are always the ones the ranking actually used (it used to be recomputed
  // per PAIR, which could label the same cohort two different ways and quote a
  // variant's job-fit number under the words "overall score").
  const metric = comparisonMetric(variants);
  const metricWord = metric === "jobFit" ? "job-fit score" : "overall score";

  const bestPrimary = primaryScore(best, metric);
  for (const other of others) {
    const otherPrimary = primaryScore(other, metric);
    const totalDelta = bestPrimary - otherPrimary;
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
  winnerIndex: number
): ComparisonPayload["mergedRecommendation"] {
  // Address the analysis by INDEX (inputs and variants are positionally aligned):
  // a label→analysis map silently collapses duplicate-filename variants to the last
  // one, so `byLabel.get(pick.label)` could pull headline/skills from a different CV
  // than the one credited as sourceLabel (analysis-result-panels #1).
  const best = variants[winnerIndex];
  const bestAnalysis = inputs[winnerIndex]?.analysis;

  const sectionPicks: SectionPick[] = [];

  const headlineIdx = pickIndexByMaxComponent(variants, "roleSeniority");
  const summaryIdx = pickIndexByMaxComponent(variants, "experience");
  const bulletsIdx = winnerIndex;
  const skillsIdx = pickIndexByMaxComponent(variants, "skills");
  const headlinePick = variants[headlineIdx];
  const summaryPick = variants[summaryIdx];
  const bulletsPick = variants[bulletsIdx];
  const skillsPick = variants[skillsIdx];

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
  // The bullets pick IS the crowned winner, so quote it on the axis it won on
  // (comparisonMetric) — quoting a job-fit number here while the cohort ranked on
  // overall totals (or vice versa) printed a figure that appears nowhere else in the
  // report.
  const metric = comparisonMetric(variants);
  sectionPicks.push({
    section: "Bullets",
    key: "bullets",
    sourceLabel: bulletsPick.label,
    reason: `Highest overall fit (${primaryScore(bulletsPick, metric).toFixed(0)}).`,
    reasonParams: { score: Math.round(primaryScore(bulletsPick, metric)) }
  });
  sectionPicks.push({
    section: "Skills line",
    key: "skillsLine",
    sourceLabel: skillsPick.label,
    reason: `Best skills coverage (${skillsPick.score.skills.toFixed(0)} pts, ${skillsPick.skillsCount} skills indexed).`,
    reasonParams: { pts: Math.round(skillsPick.score.skills), count: skillsPick.skillsCount }
  });

  const headlineCandidate =
    inputs[headlineIdx]?.analysis.candidate ?? bestAnalysis?.candidate;
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
  const skillsLine = (inputs[skillsIdx]?.analysis.candidate.skills ?? []).slice(0, 12).join(" • ");

  const bullets = mergeBestBullets(inputs, variants);

  // "allSame" iff every section was won by the SAME variant — keyed by index so two
  // distinct duplicate-label variants aren't miscounted as one.
  const summaryKind: "allSame" | "split" =
    new Set([headlineIdx, summaryIdx, bulletsIdx, skillsIdx]).size === 1 ? "allSame" : "split";

  return {
    summary: buildMergedSummary(best, sectionPicks, summaryKind),
    summaryKind,
    headline,
    headlineParams,
    skillsLine,
    bullets,
    sectionPicks
  };
}

// The INDEX of the variant with the highest score[key]; strict `>` keeps the
// earliest column on a tie (matching resolveWinnerIndex). Returns an index, not a
// variant, so the caller can address the aligned inputs[] by the same index —
// labels aren't unique.
function pickIndexByMaxComponent(variants: ComparisonVariant[], key: ComponentKey): number {
  return variants.reduce((bestI, v, i) => (v.score[key] > variants[bestI].score[key] ? i : bestI), 0);
}

function mergeBestBullets(inputs: ComparisonInput[], variants: ComparisonVariant[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  // Order INDICES by score (not variant objects), so a duplicate label can't collide
  // when we pull each variant's bullets from its own aligned input.
  const metric = comparisonMetric(variants);
  const orderedIdx = variants
    .map((_, i) => i)
    .sort((a, b) => primaryScore(variants[b], metric) - primaryScore(variants[a], metric));
  // Pull bullets from interviewTalkingPoints (when JD-bound) or strengths (otherwise);
  // both surface concrete evidence the candidate could lead a CV rewrite with.
  const bulletsByIndex = inputs.map((input) => [
    ...(input.analysis.jobFit?.interviewTalkingPoints ?? []),
    ...input.analysis.strengths,
  ]);

  for (const idx of orderedIdx) {
    const bullets = bulletsByIndex[idx] ?? [];
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
  picks: ComparisonPayload["mergedRecommendation"]["sectionPicks"],
  // The SAME verdict `summaryKind` carries, passed in rather than re-derived.
  // This used to recompute "did one variant win everything?" from
  // `new Set(picks.map(p => p.sourceLabel))` — by LABEL, the one identity this
  // whole module deliberately does not use, because labels aren't unique (two CV
  // variants can share a filename). Two distinct variants sharing a filename then
  // collapsed to one label here, so the prose said "wins every section" while
  // `summaryKind` — computed by INDEX four lines up — said "split", and CompareTab
  // localizes off `summaryKind`. One fact, two producers, disagreeing exactly where
  // the rest of the file was fixed to agree (analysis-result-panels #1).
  summaryKind: "allSame" | "split"
): string {
  // Reaches here only with >= MIN_COMPARISON_VARIANTS (buildComparison's
  // contract), so there is always more than one variant's sections to weigh.
  if (summaryKind === "allSame") {
    return `"${best.label}" wins every section. Send that variant as-is.`;
  }
  const splits = picks.map((pick) => `${pick.section.toLowerCase()} from "${pick.sourceLabel}"`).join(", ");
  return `Best merged variant pulls ${splits}. Start from "${best.label}" and graft the strongest sections from the others.`;
}
