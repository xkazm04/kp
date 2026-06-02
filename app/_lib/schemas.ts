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

// Single source of truth for the code-review payload shape: the route derives
// its CodeReviewPayload from this via z.infer, and the e2e fixture is typed
// against it, so the three former hand-maintained mirrors can no longer drift.
export const codeReviewSchema = z.object({
  status: z.enum(["disabled", "ok", "error"]),
  summary: z.string(),
  // `confirmedSkills` is the model's read on which skills the *public repo
  // signals* evidence — NOT a confirmation that the source code was inspected.
  // The deep review never reads file bodies or a recursive tree (see
  // `evidenceBasis`), so the UI surfaces these as "Evidenced Skills".
  confirmedSkills: z.array(z.string()),
  unverifiedClaims: z.array(z.string()),
  hiddenStrengths: z.array(z.string()),
  reposReviewed: z.array(z.string()),
  // Human-readable, deterministic description of the exact evidence the review
  // was built from (README text, commit subjects, root-level file names, …),
  // so the panel can state its scope instead of implying the code was read.
  evidenceBasis: z.array(z.string()),
  error: z.string().nullable()
});

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
  codeReview: codeReviewSchema.optional()
});

export type GithubAnalysis = z.infer<typeof githubAnalysisSchema>;
export type CodeReview = z.infer<typeof codeReviewSchema>;
