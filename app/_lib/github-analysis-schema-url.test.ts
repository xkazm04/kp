// Scheme-vetting guard for githubAnalysisSchema's rendered links (profileUrl and
// each topRepositories[].url). The live /api/github-analysis path feeds these
// from GitHub's API, but the persisted-report path (PATCH /api/analyses/[slug])
// accepts client-supplied values that later render as `<a href={...}>` in the
// recruiter console — so a `javascript:`/`data:` scheme would be stored XSS.
// The schema blanks any non-http(s) URL at parse time (a blank href is inert).
import { test } from "node:test";
import assert from "node:assert/strict";
import { githubAnalysisSchema } from "./schemas.ts";

const base = {
  username: "octocat",
  profileUrl: "https://github.com/octocat",
  summary: "s",
  analyzedAt: "2026-06-10T00:00:00.000Z",
  metrics: {
    publicRepos: 1, followers: 0, totalStars: 0, totalForks: 0,
    activeRepos: 1, recentlyUpdatedRepos: 0, ownedReposAnalyzed: 1,
  },
  languages: [],
  topRepositories: [{
    name: "hello", url: "https://github.com/octocat/hello", description: null,
    primaryLanguage: null, stars: 0, forks: 0, updatedAt: "2026-06-10",
    pushedAt: null, topics: [], complexitySignals: [],
  }],
  contributionSignals: [],
  jobFitSignals: { jobDescriptionProvided: false, matchingSkills: [], potentialGaps: [], complexityAssessment: "" },
  limitations: [],
};

test("valid http(s) profile and repo URLs pass through unchanged", () => {
  const parsed = githubAnalysisSchema.parse(base);
  assert.equal(parsed.profileUrl, "https://github.com/octocat");
  assert.equal(parsed.topRepositories[0].url, "https://github.com/octocat/hello");
});

test("javascript: / data: / malformed URLs are blanked, not persisted", () => {
  const evil = {
    ...base,
    profileUrl: "javascript:alert(document.cookie)",
    topRepositories: [{ ...base.topRepositories[0], url: "data:text/html,<script>alert(1)</script>" }],
  };
  const parsed = githubAnalysisSchema.parse(evil);
  assert.equal(parsed.profileUrl, "", "javascript: profileUrl must be blanked");
  assert.equal(parsed.topRepositories[0].url, "", "data: repo url must be blanked");
});
