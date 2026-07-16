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
