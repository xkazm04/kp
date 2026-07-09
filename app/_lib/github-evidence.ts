// Single source of truth for the GitHub deep-review evidence budget and the
// human-readable description of it. The /api/github-analysis route fetches repo
// signals against these limits (fetchRepoBundle) and surfaces
// describeEvidenceBasis() in the codeReview payload; the e2e fixture asserts the
// SAME strings. Both import from here so a truncation/limit change can never
// desync production from the e2e expectation — the fixture used to bake the
// numbers (3500 / 10 / 30) in by value, defeating the type-shared contract.
//
// Zero dependencies on purpose: this module is imported by both server route
// code and the Playwright fixture, so it must stay safe to load in any context.

// README text kept per repo, in characters.
export const README_TRUNCATE = 3500;
// Recent commit SUBJECT lines kept per repo (first line of each message).
export const COMMITS_PER_REPO = 10;
// Root-level file/directory NAMES kept per repo — names only, never file contents.
export const FILES_PER_REPO = 30;

// FINDING #2 (bug-ui-scan-2026-07-09): the exact, shared "could not determine"
// limitation string the /api/github-analysis route appends when some public GitHub
// data was throttled away this run. Exported so the route (producer) and
// GithubAnalysisPanel (consumer — it keys its Potential-Gaps "could not determine"
// caveat off limitations.includes(this)) reference ONE constant and can never drift.
// Lives here because this module is already the dependency-free evidence-vocabulary
// source shared by both the server route and client components.
export const EVIDENCE_INCOMPLETE_NOTE =
  "Some public GitHub data couldn't be fetched this run (likely rate limiting), so language coverage and skill-gap detection are incomplete — retry shortly for a complete read.";

// The exact, deterministic evidence the deep review is built from. Derived from
// the constants above so the documented scope can NOT drift from what is actually
// sent to the model. Text-and-metadata only: no file *bodies* and no recursive
// directory tree are ever read, so neither the model nor the UI may imply the
// source code itself was inspected.
export function describeEvidenceBasis(): string[] {
  return [
    `README text only, truncated to the first ${README_TRUNCATE} characters per repo.`,
    `Up to ${COMMITS_PER_REPO} recent commit subject lines (first line of each message) per repo.`,
    `Up to ${FILES_PER_REPO} root-level file and directory names per repo — names only, no file contents.`,
    "Primary language and repository topics from GitHub metadata.",
    "Not read: file bodies, nested/recursive directory trees, private repos, and non-default branches.",
  ];
}
