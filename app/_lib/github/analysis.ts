import { githubAnalysisSchema, type GithubAnalysis } from "@/app/_lib/schemas";
import { ACTIVE_WINDOW_MONTHS, RECENT_WINDOW_MONTHS, isWithinMonths } from "@/app/_lib/repo-activity";
import { EVIDENCE_INCOMPLETE, type GithubFinding } from "@/app/_lib/github-evidence";
import { fetchOwnedRepoPages, githubFetch, isCoverageLossError, GithubAnalysisError, type GithubUser } from "./client";
import {
  buildContributionSignals,
  buildSummary,
  complexitySignals,
  mergeLanguageMaps,
  repoRank,
  summarizeLanguages,
} from "./heuristics";
import { buildJobFitSignals } from "./skills";
import { DEEP_REVIEW_REPO_LIMIT, runCodeReview } from "./code-review";

// The /api/github-analysis pipeline: REST harvest → ranking/language heuristics →
// JD skill fit → Gemini deep review → the schema-validated payload the panel
// renders. The route handler owns only HTTP concerns (validation, the cache, the
// throttle, logging, the response envelope); everything below is the domain run,
// and its ORDER is part of the contract — the identity check must precede any
// repo read, and the deep review is the last thing that spends money.

/** Run the full public-GitHub analysis for one candidate handle. Throws on a
 *  GitHub failure or a non-personal account; the caller turns that into its own
 *  error envelope. */
export async function buildGithubAnalysis(
  username: string,
  jobDescription: string,
  requestId: string
): Promise<GithubAnalysis> {
  const user = await githubFetch<GithubUser>(`https://api.github.com/users/${encodeURIComponent(username)}`);
  // FINDING #1 (fairness): /users/{login} also resolves organizations, which share
  // the exact handle grammar and return a 200. Attributing an ORG's entire repo
  // portfolio — stars, complexity signals, job-fit — to one applicant is a silent
  // wrong-account failure. Verify "this account is a person" the moment the account
  // is first seen, BEFORE any repo is fetched or analyzed.
  if (user.type !== "User") {
    throw new GithubAnalysisError(
      "NOT_A_PERSON",
      "That handle is a GitHub organization, not a personal account. Enter an individual developer's username."
    );
  }
  // FINDING #3 (edge-case / silent-wrong-result): read the owned-repo list ACROSS
  // pages, not just the first per_page=100. Because sort=updated makes page 1 the
  // NEWEST repos, a prolific candidate (>100 repos) silently lost their oldest —
  // often most-starred / flagship — work from every total below (stars, forks,
  // language mix, the deep-review shortlist). Paginate up to a bounded cap and flag
  // when even that is exceeded so a truncated portfolio is annotated, never presented
  // as complete. Per-page shape validation lives inside the helper.
  const { repos, truncated: reposTruncated } = await fetchOwnedRepoPages(username, user.public_repos);
  const ownedRepos = repos.filter((repo) => !repo.fork);
  const reposForLanguages = ownedRepos.slice(0, 20);
  // FINDING #2 (silent-failure): each /languages sub-fetch swallows its error to
  // {}. GitHub's secondary limiter 403s bursts, so a partial throttle silently
  // drops a repo's secondary languages — which can then surface a skill the
  // candidate HAS as a Potential Gap. Record whether any sub-fetch was a coverage
  // loss (a throttle / 5xx / network error, NOT a genuine 404) so downstream can
  // treat this run as "could not determine" instead of "no evidence". A merely
  // empty language map ({}) that came back 200 is real absence, not a loss.
  let languageCoverageLost = false;
  const languageMaps = await Promise.all(
    reposForLanguages.map((repo) =>
      githubFetch<Record<string, number>>(`https://api.github.com/repos/${repo.full_name}/languages`).catch(
        (error: unknown) => {
          if (isCoverageLossError(error)) languageCoverageLost = true;
          return {} as Record<string, number>;
        }
      )
    )
  );
  const languageCoverageComplete = !languageCoverageLost;

  const languageTotals = mergeLanguageMaps(languageMaps);
  const languageSummary = summarizeLanguages(languageTotals);
  // Rank the owned repos ONCE (on a copy, so the shared ownedRepos array isn't
  // re-sorted in place under later readers) and take both slices from it — top-8
  // for display and the deep-review shortlist — instead of sorting and
  // re-evaluating repoRank twice.
  const rankedRepos = [...ownedRepos].sort((a, b) => repoRank(b) - repoRank(a));
  const topRepositories = rankedRepos
    .slice(0, 8)
    .map((repo) => ({
      name: repo.name,
      url: repo.html_url,
      description: repo.description,
      primaryLanguage: repo.language,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      updatedAt: repo.updated_at,
      pushedAt: repo.pushed_at,
      topics: repo.topics ?? [],
      complexitySignals: complexitySignals(repo)
    }));

  const totalStars = ownedRepos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
  const totalForks = ownedRepos.reduce((sum, repo) => sum + repo.forks_count, 0);
  // Both windows count code activity (pushed_at), falling back to updated_at only when the
  // repo never reported a push. Named windows + the pushed-vs-updated choice live in
  // repo-activity.ts so these recruiter-facing counts are a decided spec (idea-889dcaf4).
  const activeRepos = ownedRepos.filter((repo) => isWithinMonths(repo.pushed_at ?? repo.updated_at, ACTIVE_WINDOW_MONTHS)).length;
  const recentlyUpdatedRepos = ownedRepos.filter((repo) => isWithinMonths(repo.pushed_at ?? repo.updated_at, RECENT_WINDOW_MONTHS)).length;
  const contributionSignals = buildContributionSignals({
    ownedRepos,
    totalStars,
    totalForks,
    activeRepos,
    recentlyUpdatedRepos,
    languages: languageSummary
  });
  const jobFitSignals = buildJobFitSignals(jobDescription, ownedRepos, languageSummary, languageCoverageComplete);
  const reviewableRepos = rankedRepos.slice(0, DEEP_REVIEW_REPO_LIMIT);
  const codeReview = await runCodeReview(reviewableRepos, jobDescription, requestId);

  // The baseline caveats are a fixed set, so they travel as findings and are
  // worded by the panel's catalog rather than composed here (see github-evidence.ts).
  const limitations: GithubFinding[] = [
    { kind: "limitation.publicOnly" },
    { kind: "limitation.noGraph" },
    { kind: "limitation.metadataQuality" },
  ];
  // FINDING #2: when language coverage was lost to throttling, say so as a
  // first-class limitation. This is the run-level "could not determine" signal the
  // panel keys its Potential-Gaps caveat off (limitations.includes(this)), so a
  // partially-blind run is never presented as a complete one.
  if (!languageCoverageComplete) limitations.push(EVIDENCE_INCOMPLETE);
  // FINDING #3: when the owned-repo list was truncated at the page cap, say so as a
  // first-class limitation so a recruiter never reads ownedReposAnalyzed / totalStars
  // as a complete portfolio when older (often most-starred) repos went unanalyzed.
  if (reposTruncated) {
    limitations.push({
      kind: "limitation.truncated",
      params: { analyzed: repos.length, total: user.public_repos }
    });
  }

  const summary = buildSummary(user, ownedRepos, languageSummary, activeRepos);
  const payload = {
    username: user.login,
    profileUrl: user.html_url,
    summary: summary.text,
    summaryFinding: summary.finding,
    analyzedAt: new Date().toISOString(),
    metrics: {
      publicRepos: user.public_repos,
      followers: user.followers,
      totalStars,
      totalForks,
      activeRepos,
      recentlyUpdatedRepos,
      ownedReposAnalyzed: ownedRepos.length
    },
    languages: languageSummary,
    topRepositories,
    contributionSignals,
    jobFitSignals,
    limitations,
    codeReview
  };

  return githubAnalysisSchema.parse(payload);
}
