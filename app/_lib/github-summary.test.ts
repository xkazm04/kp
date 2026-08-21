import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGithubEvidenceSummary,
  coerceGithubEvidenceSummary,
  type GithubEvidenceSummary,
} from "./github-summary.ts";
// Type-only (erased by the strip-only runner) so this file stays dependency-free.
import type { GithubAnalysis } from "./schemas.ts";

const VALID: GithubEvidenceSummary = {
  username: "octocat",
  profileUrl: "https://github.com/octocat",
  summary: "Solid public footprint.",
  confirmedSkills: ["TypeScript", "SQL"],
  unverifiedClaims: ["Kubernetes"],
  hiddenStrengths: ["docs discipline"],
  topRepositories: [{ name: "hello", url: "https://github.com/octocat/hello" }],
  analyzedAt: "2026-06-10T00:00:00.000Z",
};

// A minimal validated analysis: the metrics sentence the run always produces, plus a
// deep review whose status the individual tests set.
function analysis(codeReview?: GithubAnalysis["codeReview"]): GithubAnalysis {
  return {
    username: "octocat",
    profileUrl: "https://github.com/octocat",
    summary: "octocat has 12 owned public repositories, 5 active in the last year, with public language evidence led by TypeScript.",
    analyzedAt: "2026-06-10T00:00:00.000Z",
    metrics: {
      publicRepos: 12, followers: 3, totalStars: 40, totalForks: 6,
      activeRepos: 5, recentlyUpdatedRepos: 2, ownedReposAnalyzed: 12,
    },
    languages: [{ name: "TypeScript", bytes: 1000, percent: 100 }],
    topRepositories: [],
    contributionSignals: [],
    jobFitSignals: {
      jobDescriptionProvided: true, matchingSkills: [], potentialGaps: [],
      complexityAssessment: { kind: "assessment.thin" },
    },
    limitations: [],
    codeReview,
  };
}

// The pipeline drawer renders this summary VERBATIM as a named candidate's GitHub
// evidence, and `codeReview.summary` is canonical-English machine copy on every
// non-ok status (schemas.ts). Freezing that put "Set GEMINI_API_KEY…" on a person's
// record — on the KEYLESS DEFAULT deployment, i.e. by default.
test("build never freezes non-ok review machine copy as a candidate's evidence", () => {
  for (const review of [
    {
      status: "disabled" as const, reason: "disabled",
      summary: "Set GEMINI_API_KEY (or add a Gemini key in Models → Keys) to enable Gemini-based repo-signal review.",
      confirmedSkills: [], unverifiedClaims: [], hiddenStrengths: [],
      reposReviewed: ["app"], evidenceBasis: [], error: null,
    },
    {
      status: "error" as const, reason: "throttled",
      summary: "Couldn't gather public repo signals — GitHub may be rate-limiting (could not determine). Try again shortly.",
      confirmedSkills: [], unverifiedClaims: [], hiddenStrengths: [],
      reposReviewed: ["app"], evidenceBasis: [], error: "could_not_determine",
    },
    {
      status: "empty" as const, reason: "noRepos",
      summary: "No owned public repositories were available to review.",
      confirmedSkills: [], unverifiedClaims: [], hiddenStrengths: [],
      reposReviewed: [], evidenceBasis: [], error: null,
    },
  ]) {
    const built = buildGithubEvidenceSummary(analysis(review));
    assert.equal(
      built.summary,
      analysis().summary,
      `${review.status}: must fall back to the metrics sentence, not the machine copy`,
    );
    assert.ok(!/GEMINI_API_KEY|rate-limiting|available to review/.test(built.summary));
  }
});

test("build keeps the model's own prose when the review actually ran", () => {
  const built = buildGithubEvidenceSummary(
    analysis({
      status: "ok", reason: null,
      summary: "Public repo signals evidence strong TypeScript tooling skills.",
      confirmedSkills: ["TypeScript"], unverifiedClaims: [], hiddenStrengths: [],
      reposReviewed: ["app"], evidenceBasis: [], error: null,
    }),
  );
  assert.equal(built.summary, "Public repo signals evidence strong TypeScript tooling skills.");
  assert.deepEqual(built.confirmedSkills, ["TypeScript"]);
});

test("coerce round-trips a valid summary", () => {
  assert.deepEqual(coerceGithubEvidenceSummary(VALID), VALID);
});

test("coerce rejects non-objects and missing identity", () => {
  assert.equal(coerceGithubEvidenceSummary(null), null);
  assert.equal(coerceGithubEvidenceSummary("octocat"), null);
  assert.equal(coerceGithubEvidenceSummary([]), null);
  assert.equal(coerceGithubEvidenceSummary({ profileUrl: "x" }), null);
  assert.equal(coerceGithubEvidenceSummary({ username: "  ", profileUrl: "x" }), null);
});

test("coerce drops dangerous-scheme URLs (stored-XSS guard)", () => {
  // profileUrl and repo url render as <a href> in the recruiter drawer — a
  // javascript:/data: payload must be neutralized to an inert empty href, while a
  // genuine github URL alongside it survives.
  const r = coerceGithubEvidenceSummary({
    ...VALID,
    profileUrl: "javascript:fetch('/api/steal')",
    topRepositories: [
      { name: "evil", url: "javascript:alert(document.cookie)" },
      { name: "ok", url: "https://github.com/octocat/ok" },
    ],
  });
  assert.equal(r?.profileUrl, "");
  assert.equal(r?.topRepositories[0].url, ""); // unsafe dropped, name preserved
  assert.equal(r?.topRepositories[0].name, "evil");
  assert.equal(r?.topRepositories[1].url, "https://github.com/octocat/ok"); // safe kept
});

test("coerce clamps oversized fields and drops non-string list entries", () => {
  const result = coerceGithubEvidenceSummary({
    ...VALID,
    summary: "x".repeat(5000),
    confirmedSkills: ["ok", 42, null, "y".repeat(5000), ...Array.from({ length: 50 }, (_, i) => `s${i}`)],
    topRepositories: [
      { name: "a", url: "u" },
      { name: "b", url: "u" },
      { name: "c", url: "u" },
      { name: "dropped", url: "u" },
      { name: 1, url: "u" },
    ],
  });
  assert.ok(result);
  assert.ok(result.summary.length <= 600);
  assert.ok(result.confirmedSkills.length <= 12);
  assert.ok(result.confirmedSkills.every((s) => typeof s === "string" && s.length <= 240));
  assert.equal(result.topRepositories.length, 3);
});

test("coerce defaults absent optional fields to empty", () => {
  const result = coerceGithubEvidenceSummary({ username: "u", profileUrl: "p" });
  assert.ok(result);
  assert.equal(result.summary, "");
  assert.deepEqual(result.confirmedSkills, []);
  assert.deepEqual(result.topRepositories, []);
});
