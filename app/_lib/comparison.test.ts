// Pins THE minimum-variant contract for a comparison (idea-38a6fd70). One number,
// MIN_COMPARISON_VARIANTS, decides what "a comparison" is, and three surfaces must
// agree on it: buildComparison refuses to build one below the floor, comparisonSchema
// refuses to parse one, and hasRenderableComparison (the gate ResultPanel + CompareTab
// share) refuses to render one. These tests lock the 0-, 1-, and 2-variant boundary so
// the four paths can't drift back into disagreeing the way they did before.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MIN_COMPARISON_VARIANTS,
  analysisSchema,
  comparisonSchema,
  type Analysis,
} from "./schemas.ts";
import { buildComparison, hasRenderableComparison, resolveWinnerIndex } from "./comparison.ts";

// A valid AnalysisResult with no comparison — the per-variant input buildComparison
// consumes. Built through analysisSchema.parse so the fixture is self-checking: if it
// ever drifts from the real schema this throws here, not deep inside buildComparison.
function analysisWith(opts: {
  total: number;
  experience: number;
  skills: number;
  roleSeniority: number;
  education: number;
  traits: number;
  yearsExperience: number;
  skillList: string[];
  /** Optional job-fit read. `jobFit` is nullish in the persisted schema: each CV
   *  variant is an independent engine call, so a JD-bound run can return a job-fit
   *  read for one variant and none for another. */
  jobFitScore?: number;
}): Analysis {
  return analysisSchema.parse({
    candidate: {
      rawText: "Senior engineer with years building payment systems.",
      yearsExperience: opts.yearsExperience,
      currentSeniority: "senior",
      roleFamily: "software_engineering",
      skills: opts.skillList,
      educationLevel: "bachelor",
      languages: ["english"],
      traits: ["pragmatic"],
      evidence: ["Led migration to event-driven architecture."],
    },
    score: {
      total: opts.total,
      experience: opts.experience,
      skills: opts.skills,
      roleSeniority: opts.roleSeniority,
      education: opts.education,
      traits: opts.traits,
    },
    salary: {
      currency: "USD",
      period: "year",
      minimum: 150000,
      maximum: 190000,
      midpoint: 170000,
      confidence: "medium",
      rationale: ["Anchored to senior backend band."],
    },
    strengths: ["Deep payments domain knowledge."],
    gaps: ["No formal management experience."],
    recommendations: ["Highlight system-design ownership."],
    explanation: "Strong senior backend match.",
    sanityChecks: [],
    ...(opts.jobFitScore == null
      ? {}
      : {
          jobFit: {
            score: opts.jobFitScore,
            summary: "Fits the payments brief.",
            matchingSkills: ["python"],
            missingSkills: ["kafka"],
            seniorityAlignment: "aligned",
            roleAlignment: "aligned",
            salaryAssessment: "within band",
            recommendations: ["Probe event-driven depth."],
            interviewTalkingPoints: ["Walk through the migration."],
            cvRewriteSuggestions: ["Lead with payments scale."],
            mustProveEvidence: ["Ownership of the migration."],
            negotiationAngle: "Mid-band offer.",
            recruiterRiskFlags: [],
          },
        }),
  });
}

const variantA = {
  label: "Variant A",
  analysis: analysisWith({
    total: 82,
    experience: 18,
    skills: 20,
    roleSeniority: 16,
    education: 14,
    traits: 14,
    yearsExperience: 8,
    skillList: ["python", "typescript"],
  }),
};
const variantB = {
  label: "Variant B",
  analysis: analysisWith({
    total: 70,
    experience: 14,
    skills: 18,
    roleSeniority: 12,
    education: 12,
    traits: 14,
    yearsExperience: 5,
    skillList: ["python"],
  }),
};

test("the contract floor is the documented two variants", () => {
  assert.equal(MIN_COMPARISON_VARIANTS, 2);
});

// ── buildComparison: the boundary at the builder ──────────────────────────────

test("buildComparison refuses 0 variants", () => {
  assert.throws(() => buildComparison([]), /at least 2/);
});

test("buildComparison refuses 1 variant", () => {
  assert.throws(() => buildComparison([variantA]), /at least 2/);
});

test("buildComparison builds a real comparison at 2 variants", () => {
  const comparison = buildComparison([variantA, variantB]);
  assert.equal(comparison.variants.length, 2);
  // variants preserve upload order; the winner is ranked separately by score.
  assert.equal(comparison.variants[0].label, "Variant A");
  assert.equal(comparison.bestLabel, "Variant A");
  // The multi-variant path actually runs — not the old single-variant special
  // cases that returned an empty driver list and an "only one variant" summary.
  assert.ok(comparison.driverInsights.length > 0, "expected driver insights at >=2 variants");
  assert.doesNotMatch(comparison.mergedRecommendation.summary, /only one variant/i);
});

// ── the codes+params seam (compare-speaks-your-language) ──────────────────────
// The compare narrative is rendered from STRUCTURED codes so CompareTab can localize
// it; the English strings survive only as the fallback for pre-seam payloads. These
// pin the codes so a wording tweak in messages/*.json can't silently change the data.

test("buildComparison emits structured driver items alongside the English strings", () => {
  const comparison = buildComparison([variantA, variantB]);
  const items = comparison.driverInsightItems;
  assert.ok(items && items.length > 0, "expected structured driver items");
  // A leads B by 12 on the overall score (no job-fit read → metric 'overall').
  const delta = items.find((i) => i.kind === "delta");
  assert.ok(delta && delta.kind === "delta");
  assert.deepEqual(
    { best: delta.best, other: delta.other, dir: delta.dir, amount: delta.amount, metric: delta.metric, bestScore: delta.bestScore, otherScore: delta.otherScore },
    { best: "Variant A", other: "Variant B", dir: "lead", amount: 12, metric: "overall", bestScore: 82, otherScore: 70 }
  );
  // Top component driver: experience (+4 pts vs B), a win for the leader.
  const driver = items.find((i) => i.kind === "driver");
  assert.ok(driver && driver.kind === "driver");
  assert.equal(driver.component, "experience");
  assert.equal(driver.dir, "win");
  assert.equal(driver.amount, 4);
});

test("buildComparison emits structured merged-recommendation fields", () => {
  const { mergedRecommendation: m } = buildComparison([variantA, variantB]);
  // Every section is pulled from Variant A here → the 'allSame' summary sentence.
  assert.equal(m.summaryKind, "allSame");
  // Section picks carry stable, non-display keys (they double as React keys) + params.
  assert.deepEqual(m.sectionPicks.map((p) => p.key), ["headline", "summary", "bullets", "skillsLine"]);
  const headlinePick = m.sectionPicks.find((p) => p.key === "headline");
  assert.equal(headlinePick?.reasonParams?.pts, 16);
  // Headline is emitted as enum slugs (localized at render), not baked English words.
  assert.deepEqual(m.headlineParams, {
    seniority: "senior",
    roleFamily: "software_engineering",
    skills: ["python", "typescript"],
  });
});

// ── resolveWinnerIndex: the ONE shared winner rule ────────────────────────────
// buildComparison, CompareTab (crowned column) and verdict.ts (banner) all resolve
// the winner through this, so they can't disagree. Strict `>` keeps the earliest on a tie.

test("resolveWinnerIndex picks the max-primaryScore variant, earliest on a tie", () => {
  const comparison = buildComparison([variantA, variantB]);
  assert.equal(resolveWinnerIndex(comparison.variants), 0);
  // A tie resolves to the earliest column (index 0), matching bestLabel's stable rank.
  const tied = [comparison.variants[0], { ...comparison.variants[1], score: { ...comparison.variants[1].score, total: comparison.variants[0].score.total } }];
  assert.equal(resolveWinnerIndex(tied), 0);
});

// ── comparisonSchema: the boundary at the persisted contract ──────────────────
// Slice a genuinely-shaped, valid 2-variant payload down so the only thing wrong
// about the 0- and 1-variant cases is the variant count — proving it is the
// .min(MIN_COMPARISON_VARIANTS) rule rejecting them, not some unrelated field.

test("comparisonSchema accepts a 2-variant payload", () => {
  const valid = buildComparison([variantA, variantB]);
  assert.equal(comparisonSchema.safeParse(valid).success, true);
});

test("comparisonSchema rejects a 1-variant payload", () => {
  const valid = buildComparison([variantA, variantB]);
  const oneVariant = { ...valid, variants: valid.variants.slice(0, 1) };
  assert.equal(comparisonSchema.safeParse(oneVariant).success, false);
});

test("comparisonSchema rejects a 0-variant payload", () => {
  const valid = buildComparison([variantA, variantB]);
  const zeroVariants = { ...valid, variants: [] };
  assert.equal(comparisonSchema.safeParse(zeroVariants).success, false);
});

// ── hasRenderableComparison: the boundary the UI renders by ────────────────────
// ResultPanel (Compare tab default) and CompareTab (table vs. upload prompt) both
// gate on this, so locking it here locks both surfaces at once.

test("hasRenderableComparison is false for absent / 0 / 1 variants, true at 2", () => {
  const valid = buildComparison([variantA, variantB]);
  assert.equal(hasRenderableComparison(undefined), false);
  assert.equal(hasRenderableComparison(null), false);
  assert.equal(hasRenderableComparison({ ...valid, variants: [] }), false);
  assert.equal(hasRenderableComparison({ ...valid, variants: valid.variants.slice(0, 1) }), false);
  assert.equal(hasRenderableComparison(valid), true);
});

// ── Duplicate-label identity (analysis-result-panels #1) ──────────────────────
// Labels aren't unique (two CV variants can share a filename). The driver narrative
// and merged recommendation must key by INDEX, not label, or a distinct same-label
// variant is dropped from the drivers and the merged recommendation attributes one
// CV's content to another. resolveWinnerIndex already keys by index; these pin the
// narrative half.
test("a distinct variant sharing the winner's label is still compared (not label-filtered out)", () => {
  // v0 (winner) and v1 share the filename "dup.pdf"; v2 is distinct.
  const v0 = { label: "dup.pdf", analysis: analysisWith({ total: 90, experience: 22, skills: 28, roleSeniority: 20, education: 15, traits: 15, yearsExperience: 10, skillList: ["alphaonly"] }) };
  const v1 = { label: "dup.pdf", analysis: analysisWith({ total: 60, experience: 12, skills: 14, roleSeniority: 10, education: 10, traits: 12, yearsExperience: 4, skillList: ["betaonly"] }) };
  const v2 = { label: "unique.pdf", analysis: analysisWith({ total: 55, experience: 11, skills: 12, roleSeniority: 9, education: 9, traits: 11, yearsExperience: 3, skillList: ["gammaonly"] }) };
  const payload = buildComparison([v0, v1, v2]);

  // Both non-winner variants (v1 shares the winner's label, v2 doesn't) get a
  // top-level comparison. Pre-fix the label filter excluded v1 too, leaving 1.
  const topLevel = (payload.driverInsightItems ?? []).filter((it) => it.kind === "delta" || it.kind === "tie").length;
  assert.equal(topLevel, 2, "both non-winner variants are compared, including the one sharing the winner's label");
});

// ── One cohort, ONE ranking axis (mixed job-fit reads) ────────────────────────
// `jobFit` is nullish PER VARIANT (schemas.generated.ts) because every variant is an
// independent engine call — a JD-bound multi-CV run can come back with a job-fit read
// for one CV and none for another. Job-fit and the component total are two different
// 0-100 producers, so the axis must be resolved ONCE for the cohort (job-fit only when
// every variant carries one) instead of per variant. Picking it per variant crowned a
// jobFit-82/total-55 CV over a total-74 CV and then quoted the 82 under the words
// "overall score" — one ranking mixing two score producers.
test("a cohort where only ONE variant has a job-fit read ranks on the shared overall axis", () => {
  // withFit: job-fit 82 but a weak overall 55. noFit: no job-fit read, overall 74.
  const withFit = {
    label: "with-fit.pdf",
    analysis: analysisWith({ total: 55, experience: 12, skills: 14, roleSeniority: 11, education: 9, traits: 9, yearsExperience: 4, skillList: ["python"], jobFitScore: 82 }),
  };
  const noFit = {
    label: "no-fit.pdf",
    analysis: analysisWith({ total: 74, experience: 18, skills: 20, roleSeniority: 14, education: 11, traits: 11, yearsExperience: 7, skillList: ["python", "go"] }),
  };
  const payload = buildComparison([withFit, noFit]);

  // The only axis BOTH variants carry is the component total: 74 > 55.
  assert.equal(payload.bestLabel, "no-fit.pdf");
  assert.equal(resolveWinnerIndex(payload.variants), 1);

  const delta = (payload.driverInsightItems ?? []).find((i) => i.kind === "delta");
  assert.ok(delta && delta.kind === "delta");
  assert.equal(delta.metric, "overall");
  // The reported numbers are the ones the ranking actually used — never the loser's
  // job-fit 82 printed under the words "overall score".
  assert.deepEqual(
    { best: delta.best, other: delta.other, dir: delta.dir, amount: delta.amount, bestScore: delta.bestScore, otherScore: delta.otherScore },
    { best: "no-fit.pdf", other: "with-fit.pdf", dir: "lead", amount: 19, bestScore: 74, otherScore: 55 }
  );
  // The bullets pick quotes the winner on the SAME axis, so the figure the merged
  // recommendation shows is one that appears in the compare grid.
  const bullets = payload.mergedRecommendation.sectionPicks.find((p) => p.key === "bullets");
  assert.equal(bullets?.reasonParams?.score, 74);
});

test("a cohort where EVERY variant has a job-fit read still ranks on job-fit", () => {
  // Non-regression for the documented preference (verdict.test.ts pins the same rule):
  // when the axis exists for the whole cohort, the lower total but higher job-fit wins.
  const a = {
    label: "a.pdf",
    analysis: analysisWith({ total: 90, experience: 22, skills: 28, roleSeniority: 20, education: 10, traits: 10, yearsExperience: 10, skillList: ["python"], jobFitScore: 40 }),
  };
  const b = {
    label: "b.pdf",
    analysis: analysisWith({ total: 50, experience: 10, skills: 12, roleSeniority: 10, education: 9, traits: 9, yearsExperience: 3, skillList: ["go"], jobFitScore: 88 }),
  };
  const payload = buildComparison([a, b]);

  assert.equal(payload.bestLabel, "b.pdf");
  const delta = (payload.driverInsightItems ?? []).find((i) => i.kind === "delta");
  assert.ok(delta && delta.kind === "delta");
  assert.equal(delta.metric, "jobFit");
  assert.equal(delta.bestScore, 88);
  assert.equal(delta.otherScore, 40);
});

test("the merged recommendation pulls each section from the index-matched CV, not the label-collision last one", () => {
  const v0 = { label: "dup.pdf", analysis: analysisWith({ total: 90, experience: 22, skills: 28, roleSeniority: 20, education: 15, traits: 15, yearsExperience: 10, skillList: ["alphaonly", "shared"] }) };
  const v1 = { label: "dup.pdf", analysis: analysisWith({ total: 60, experience: 12, skills: 14, roleSeniority: 10, education: 10, traits: 12, yearsExperience: 4, skillList: ["betaonly"] }) };
  const payload = buildComparison([v0, v1]);

  // v0 wins the skills component (28 > 14). Pre-fix byLabel.get("dup.pdf") collapsed
  // to the LAST analysis (v1), so the skills line showed v1's "betaonly".
  const skillsLine = payload.mergedRecommendation.skillsLine;
  assert.ok(skillsLine.includes("alphaonly"), `skills line must use the winner's own skills, got: ${skillsLine}`);
  assert.ok(!skillsLine.includes("betaonly"), `skills line must NOT pull the colliding variant's skills, got: ${skillsLine}`);
});
