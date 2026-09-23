// The skill ledger is the ONE place a recruiter reads the GitHub deep-dive's verdict
// on a skill. It joins two engines that used to render as five unreconciled lists
// (label matches, label gaps, and the review's evidenced / "unverified" / hidden
// lists), and it keeps the registry's three-bucket rule by construction
// (recruiting/public-work-evidence-bounding, corroborate-a-claim-never-replace-it):
// a claim the public record does not show is NOT REACHED, never "unverified", and a
// read that lost coverage says COULD NOT DETERMINE, never a negative.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSkillLedger, SKILL_LEDGER_VERDICTS, type SkillLedgerRow } from "./skill-ledger.ts";
import { EVIDENCE_INCOMPLETE } from "../github-evidence.ts";
import { githubAnalysisSchema, type CodeReview, type GithubAnalysis } from "../schemas.ts";

type JobFit = GithubAnalysis["jobFitSignals"];

function jobFit(over: Partial<JobFit> = {}): JobFit {
  return {
    jobDescriptionProvided: true,
    matchingSkills: [],
    potentialGaps: [],
    trackedSkillCount: 28,
    complexityAssessment: { kind: "assessment.moderate" },
    ...over,
  };
}

function review(over: Partial<CodeReview> = {}): CodeReview {
  return {
    status: "ok",
    summary: "s",
    confirmedSkills: [],
    unverifiedClaims: [],
    hiddenStrengths: [],
    reposReviewed: [],
    evidenceBasis: [],
    error: null,
    ...over,
  } as CodeReview;
}

const rowsFor = (rows: SkillLedgerRow[], skill: string) => rows.filter((r) => r.skill === skill);

test("a label gap the review evidences is ONE corroborated row, not a gap row plus an evidenced row", () => {
  const rows = buildSkillLedger(jobFit({ potentialGaps: ["docker"] }), review({ confirmedSkills: ["Docker"] }), []);
  const docker = rowsFor(rows, "docker");
  assert.equal(docker.length, 1, `one skill, one row; saw ${JSON.stringify(rows)}`);
  assert.equal(docker[0].verdict, "corroborated");
  assert.deepEqual(docker[0].sources, ["review"]);
});

test("a label match the review calls unverified stays corroborated, with the repo named and the disagreement visible", () => {
  const rows = buildSkillLedger(
    jobFit({ matchingSkills: ["react"], skillEvidence: { react: ["ui-kit"] } }),
    review({ unverifiedClaims: ["React"] }),
    [],
  );
  const react = rowsFor(rows, "react");
  assert.equal(react.length, 1);
  assert.equal(react[0].verdict, "corroborated");
  assert.deepEqual(react[0].sources, ["labels"]);
  assert.deepEqual(react[0].repos, ["ui-kit"]);
  assert.equal(react[0].reviewDisagrees, true);
});

test("under EVIDENCE_INCOMPLETE a JD skill with no evidence is could-not-determine, never not-reached", () => {
  // Both ways the JD skill can arrive on a partial run: the label engine's own
  // undetermined list, and the review's free-text "unverified" list (the only trace a
  // payload stored before undeterminedSkills existed carries).
  const rows = buildSkillLedger(
    jobFit({ undeterminedSkills: ["rust"] }),
    review({ unverifiedClaims: ["Go"] }),
    [EVIDENCE_INCOMPLETE],
  );
  for (const skill of ["rust", "go"]) {
    const row = rowsFor(rows, skill);
    assert.equal(row.length, 1, skill);
    assert.equal(row[0].verdict, "couldNotDetermine", `${skill} was not reached because the read was cut short`);
  }
  assert.ok(!rows.some((r) => r.verdict === "notReached"), "no neutral-absence verdict from a partial read");
});

test("a legacy gap under the incomplete-evidence limitation is also could-not-determine", () => {
  const rows = buildSkillLedger(jobFit({ potentialGaps: ["rust"] }), undefined, [EVIDENCE_INCOMPLETE]);
  assert.equal(rowsFor(rows, "rust")[0].verdict, "couldNotDetermine");
});

test("on a complete read a JD skill the evidence does not show is not reached (neutral), never a claim marked false", () => {
  const rows = buildSkillLedger(jobFit({ potentialGaps: ["rust"] }), review({ unverifiedClaims: ["event sourcing"] }), []);
  assert.equal(rowsFor(rows, "rust")[0].verdict, "notReached");
  const free = rows.find((r) => r.label === "event sourcing");
  assert.ok(free, "free text outside the taxonomy still gets its row");
  assert.equal(free.verdict, "notReached");
  assert.deepEqual(free.sources, ["review"]);
});

test("with no JD there are no JD-skill rows at all; hidden strengths still surface as unclaimed", () => {
  const rows = buildSkillLedger(
    jobFit({ jobDescriptionProvided: false }),
    review({ hiddenStrengths: ["observability"], unverifiedClaims: ["Kubernetes"] }),
    [],
  );
  assert.ok(rows.every((r) => r.verdict === "unclaimed"), JSON.stringify(rows));
  assert.deepEqual(rows.map((r) => r.label), ["observability"]);
});

test("a hidden strength that is really a JD skill does not duplicate the JD row", () => {
  const rows = buildSkillLedger(
    jobFit({ matchingSkills: ["python"], skillEvidence: { python: ["svc"] } }),
    review({ hiddenStrengths: ["Python", "CI tooling"] }),
    [],
  );
  assert.equal(rowsFor(rows, "python").length, 1);
  assert.equal(rowsFor(rows, "python")[0].verdict, "corroborated");
  assert.equal(rowsFor(rows, "ci")[0].verdict, "unclaimed");
});

test("rows read JD verdicts first, unclaimed strengths last", () => {
  const rows = buildSkillLedger(
    jobFit({ matchingSkills: ["python"], potentialGaps: ["rust"] }),
    review({ hiddenStrengths: ["observability"] }),
    [],
  );
  assert.deepEqual(rows.map((r) => r.verdict), ["corroborated", "notReached", "unclaimed"]);
});

test("a payload stored before skillEvidence existed parses and still builds its rows", () => {
  const legacy = {
    username: "octocat",
    profileUrl: "https://github.com/octocat",
    summary: "s",
    analyzedAt: "2026-06-10T00:00:00.000Z",
    metrics: { publicRepos: 1, followers: 0, totalStars: 0, totalForks: 0, activeRepos: 1, recentlyUpdatedRepos: 0, ownedReposAnalyzed: 1 },
    languages: [],
    topRepositories: [],
    contributionSignals: [],
    jobFitSignals: { jobDescriptionProvided: true, matchingSkills: ["Python", "LLM"], potentialGaps: ["Azure"], complexityAssessment: "" },
    limitations: ["Public repositories only"],
  };
  const parsed = githubAnalysisSchema.parse(legacy);
  const rows = buildSkillLedger(parsed.jobFitSignals, parsed.codeReview, parsed.limitations);
  assert.deepEqual(
    rows.map((r) => [r.skill, r.verdict, r.repos]),
    [["python", "corroborated", []], ["ai", "corroborated", []], ["cloud", "notReached", []]],
  );
});

test("every ledger verdict and the disagreement marker have a catalog line in all four locales", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), "utf8"));
    const ledger = catalog?.results?.github?.ledger;
    assert.ok(ledger, `${locale}: results.github.ledger missing`);
    for (const verdict of SKILL_LEDGER_VERDICTS) {
      assert.equal(typeof ledger.verdict?.[verdict], "string", `${locale}: ledger.verdict.${verdict}`);
    }
    assert.equal(typeof ledger.reviewDisagrees, "string", `${locale}: ledger.reviewDisagrees`);
  }
});
