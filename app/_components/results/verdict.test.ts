// Direction 1 (verdict-above-the-fold) — the leading verdict resolver. Pins that
// the banner reads the reconciled overall (component sum, not the raw pipeline
// total), surfaces job-fit only when present, and crowns the SAME winner the
// compare grid does.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveVerdict } from "./verdict.ts";
import type { Analysis } from "@/app/_lib/schemas";

// Minimal Analysis stub — only the fields resolveVerdict reads. Cast through
// unknown so the test doesn't have to construct the full (large) schema.
function analysis(over: Partial<Analysis>): Analysis {
  return {
    score: { total: 0, experience: 0, skills: 0, roleSeniority: 0, education: 0, traits: 0 },
    ...over,
  } as unknown as Analysis;
}

const score = (parts: { experience: number; skills: number; roleSeniority: number; education: number; traits: number }) => ({
  // A deliberately WRONG total to prove the resolver ignores it and re-sums.
  total: 999,
  ...parts,
});

test("single analysis: overall is the component SUM, not the raw total", () => {
  const v = resolveVerdict(
    analysis({ score: score({ experience: 20, skills: 25, roleSeniority: 18, education: 8, traits: 6 }) })
  );
  assert.equal(v.overall, 77);
  assert.equal(v.jobFit, null);
  assert.equal(v.winnerLabel, null);
});

test("single analysis: job-fit score is surfaced when present", () => {
  const v = resolveVerdict(
    analysis({
      score: score({ experience: 10, skills: 10, roleSeniority: 10, education: 5, traits: 5 }),
      jobFit: { score: 82 } as Analysis["jobFit"],
    })
  );
  assert.equal(v.overall, 40);
  assert.equal(v.jobFit, 82);
});

test("multi-variant: crowns the max-primaryScore winner (job-fit wins over total)", () => {
  const variant = (label: string, total: number, jobFitScore: number | null) => ({
    label,
    score: { total, experience: total, skills: 0, roleSeniority: 0, education: 0, traits: 0 },
    jobFitScore,
    keywordCoveragePercent: null,
    matchingSkills: [],
    missingSkills: [],
    strengths: [],
    gaps: [],
    skillsCount: 0,
    yearsExperience: 0,
  });
  // B has the lower total but the higher job-fit — primaryScore prefers job-fit,
  // so B must win (the same rule CompareTab crowns by).
  const v = resolveVerdict(
    analysis({
      comparison: {
        variants: [variant("A", 90, 40), variant("B", 50, 88)],
        bestLabel: "B",
        driverInsights: [],
        mergedRecommendation: { summary: "", headline: "", skillsLine: "", bullets: [], sectionPicks: [] },
      } as unknown as Analysis["comparison"],
    })
  );
  assert.equal(v.winnerLabel, "B");
  assert.equal(v.jobFit, 88);
  assert.equal(v.overall, 50); // winner B's component sum
});
