import { z } from "zod";
import { analysisResultSchema } from "./schemas.generated";

export { analysisResultSchema };
export type { AnalysisResult } from "./schemas.generated";

const comparisonScoreSchema = z.object({
  total: z.number(),
  experience: z.number(),
  skills: z.number(),
  roleSeniority: z.number(),
  education: z.number(),
  traits: z.number()
});

const comparisonVariantSchema = z.object({
  label: z.string(),
  score: comparisonScoreSchema,
  jobFitScore: z.number().nullable(),
  keywordCoveragePercent: z.number().nullable(),
  matchingSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  skillsCount: z.number(),
  yearsExperience: z.number()
});

export const comparisonSchema = z.object({
  variants: z.array(comparisonVariantSchema),
  bestLabel: z.string(),
  driverInsights: z.array(z.string()),
  mergedRecommendation: z.object({
    summary: z.string(),
    headline: z.string(),
    skillsLine: z.string(),
    bullets: z.array(z.string()),
    sectionPicks: z.array(
      z.object({
        section: z.string(),
        sourceLabel: z.string(),
        reason: z.string()
      })
    )
  })
});

export const analysisSchema = analysisResultSchema.extend({
  comparison: comparisonSchema.optional()
});

export type Analysis = z.infer<typeof analysisSchema>;

export const githubAnalysisSchema = z.object({
  username: z.string(),
  profileUrl: z.string(),
  summary: z.string(),
  analyzedAt: z.string(),
  metrics: z.object({
    publicRepos: z.number(),
    followers: z.number(),
    totalStars: z.number(),
    totalForks: z.number(),
    activeRepos: z.number(),
    recentlyUpdatedRepos: z.number(),
    ownedReposAnalyzed: z.number()
  }),
  languages: z.array(
    z.object({
      name: z.string(),
      bytes: z.number(),
      percent: z.number()
    })
  ),
  topRepositories: z.array(
    z.object({
      name: z.string(),
      url: z.string(),
      description: z.string().nullable(),
      primaryLanguage: z.string().nullable(),
      stars: z.number(),
      forks: z.number(),
      updatedAt: z.string(),
      pushedAt: z.string().nullable(),
      topics: z.array(z.string()),
      complexitySignals: z.array(z.string())
    })
  ),
  contributionSignals: z.array(z.string()),
  jobFitSignals: z.object({
    matchingSkills: z.array(z.string()),
    potentialGaps: z.array(z.string()),
    complexityAssessment: z.string()
  }),
  limitations: z.array(z.string()),
  codeReview: z
    .object({
      status: z.enum(["disabled", "ok", "error"]),
      summary: z.string(),
      confirmedSkills: z.array(z.string()),
      unverifiedClaims: z.array(z.string()),
      hiddenStrengths: z.array(z.string()),
      reposReviewed: z.array(z.string()),
      error: z.string().nullable()
    })
    .optional()
});

export type GithubAnalysis = z.infer<typeof githubAnalysisSchema>;
