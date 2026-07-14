import { z } from "zod";
import { analysisResultSchema } from "./schemas.generated.ts";
import { CODE_REVIEW_STATUSES } from "./code-review-status.ts";

export { analysisResultSchema };
export type { AnalysisResult } from "./schemas.generated.ts";

// Mirrors the `score` breakdown on `analysisResultSchema` (above, generated from
// pipeline/jobfit/models.py::ScoreBreakdown). Contract: `total` is DEFINED as the
// sum of the five components (experience/skills/roleSeniority/education/traits,
// maxima 25/30/23/12/10 → 100). The pipeline doesn't enforce that, so any surface
// rendering a total beside its parts reconciles it via reconcileScoreTotal in
// ./format.ts — see the score-breakdown invariant documented there.
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

// THE minimum-variant contract for a comparison (idea-38a6fd70). A comparison
// exists to contrast CV variants against one another, so it is only meaningful
// with at least two of them. Pinned here once so the four paths that used to
// disagree about what "a comparison" is now read from one number: buildComparison
// refuses to build one below this, comparisonSchema below refuses to parse one,
// and the UI (ResultPanel's Compare tab default + CompareTab's render guard, via
// hasRenderableComparison) refuses to render one. Change it here and everywhere
// follows.
export const MIN_COMPARISON_VARIANTS = 2;

export const comparisonSchema = z.object({
  // The persisted contract: a comparison carries at least MIN_COMPARISON_VARIANTS
  // variants. A 0- or 1-variant payload is rejected on read (the history/task
  // loaders surface "saved in an older schema"), which is exactly right — such a
  // payload is never produced today and is no longer a state the UI supports.
  variants: z.array(comparisonVariantSchema).min(MIN_COMPARISON_VARIANTS),
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
  comparison: comparisonSchema.optional(),
  // The save receipt analyze-run attaches server-side ({ slug, createdAt } or
  // null when persistence failed). Declaring it here (CV1 enabler) keeps zod
  // from stripping it on the client parse, so the live Analyze tab can address
  // the saved row — e.g. PATCH the GitHub deep-dive onto it (GH1) or link the
  // stable /history/<slug> report.
  // `candidateLabel` + `jdSlug` are echoed from the persisted row so the live
  // Analyze result can offer the same "Add to pipeline" the saved report does,
  // filed under the exact label the board's on-board chip matches by and the JD
  // slug the board keys lanes on (Direction 1). Nullish: a JD-less run has no
  // slug; a failed persist yields a null receipt entirely.
  persistence: z
    .object({
      slug: z.string(),
      createdAt: z.string(),
      candidateLabel: z.string().nullish(),
      jdSlug: z.string().nullish(),
    })
    .nullish(),
  // Direction 2 — settled multi-CV semantics: when a comparison delivers with one
  // or more variants having failed, the survivors still produce a result and the
  // failed variant(s) are NAMED here (which file, what error) so the client can
  // surface them in the result UI, not bury them in logs. Attached by analyze-run
  // only on a partial run; absent on a clean or single-CV run.
  partialFailures: z.array(z.object({ label: z.string(), error: z.string() })).nullish(),
  // True when the delivered run did NO new engine work — every surviving variant
  // was served from the analyze cache (a re-run / duplicate). The live Analyze
  // result reads this to show a "served from cache, no new cost" note.
  servedFromCache: z.boolean().nullish()
});

export type Analysis = z.infer<typeof analysisSchema>;

// Single source of truth for the code-review payload shape: the route derives
// its CodeReviewPayload from this via z.infer, and the e2e fixture is typed
// against it, so the three former hand-maintained mirrors can no longer drift.
export const codeReviewSchema = z.object({
  // Derived from the single CODE_REVIEW_STATUSES list (see that module for what
  // each of the four states means). `empty` is distinct from `ok` so an empty
  // review — no owned public repos — is never mistaken for evidenced-skills data.
  status: z.enum(CODE_REVIEW_STATUSES),
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
    // True iff a non-empty job description was supplied for this run. Lets the UI tell
    // "no JD provided — we never ran a comparison" apart from "JD analyzed, zero overlap",
    // which are opposite conclusions about the same candidate (idea-2dd27822). Without it,
    // an empty matchingSkills list is ambiguous and a benign empty input reads as a skills gap.
    jobDescriptionProvided: z.boolean(),
    matchingSkills: z.array(z.string()),
    potentialGaps: z.array(z.string()),
    // How many skills the fixed taxonomy covers — so the UI can say "compared against
    // N tracked skills" and a recruiter doesn't read "no gaps" as exhaustive.
    // Nullish for backward-compat with any response cached before this field existed.
    trackedSkillCount: z.number().nullish(),
    complexityAssessment: z.string()
  }),
  limitations: z.array(z.string()),
  codeReview: codeReviewSchema.optional()
});

export type GithubAnalysis = z.infer<typeof githubAnalysisSchema>;
export type CodeReview = z.infer<typeof codeReviewSchema>;
