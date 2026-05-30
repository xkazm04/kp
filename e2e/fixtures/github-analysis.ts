import type { Page } from "@playwright/test";

// A deterministic GitHub-analysis payload (shape matches githubAnalysisSchema).
// The browser fetches /api/github-analysis client-side, so Playwright can route
// it — removing the anonymous GitHub API rate-limit (60/hr) flake that forced
// the smoke tests to accept a rate-limit error as a pass.
export const GITHUB_ANALYSIS_FIXTURE = {
  username: "xkazm04",
  profileUrl: "https://github.com/xkazm04",
  summary: "Active engineer with a focus on Python and TypeScript automation.",
  analyzedAt: "2026-05-30T00:00:00.000Z",
  metrics: {
    publicRepos: 24,
    followers: 31,
    totalStars: 128,
    totalForks: 18,
    activeRepos: 9,
    recentlyUpdatedRepos: 6,
    ownedReposAnalyzed: 9,
  },
  languages: [
    { name: "Python", bytes: 420000, percent: 52 },
    { name: "TypeScript", bytes: 280000, percent: 35 },
    { name: "Shell", bytes: 104000, percent: 13 },
  ],
  topRepositories: [
    {
      name: "llm-automation",
      url: "https://github.com/xkazm04/llm-automation",
      description: "RAG + MCP tooling for production LLM workflows",
      primaryLanguage: "Python",
      stars: 64,
      forks: 9,
      updatedAt: "2026-05-20T00:00:00.000Z",
      pushedAt: "2026-05-20T00:00:00.000Z",
      topics: ["llm", "rag", "automation"],
      complexitySignals: ["async pipelines", "test coverage"],
    },
  ],
  contributionSignals: ["consistent recent commits", "maintains multiple active repos"],
  jobFitSignals: {
    matchingSkills: ["Python", "TypeScript", "LLM", "RAG"],
    potentialGaps: ["Azure"],
    complexityAssessment: "Handles production-grade automation with real complexity.",
  },
  limitations: ["Public repositories only"],
  codeReview: {
    status: "ok" as const,
    summary: "Code confirms strong Python + LLM tooling skills.",
    confirmedSkills: ["Python", "LLM"],
    unverifiedClaims: [],
    hiddenStrengths: ["observability"],
    reposReviewed: ["llm-automation"],
    error: null,
  },
};

/** Route the app's /api/github-analysis endpoint to the fixture above. */
export async function stubGithubAnalysis(page: Page): Promise<void> {
  await page.route("**/api/github-analysis", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(GITHUB_ANALYSIS_FIXTURE),
    });
  });
}
