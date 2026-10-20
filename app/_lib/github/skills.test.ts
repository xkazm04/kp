// The JD↔GitHub skill comparison produces the "Matching Skills" and "Potential
// Gaps" a recruiter reads as a hiring signal, and its whole correctness rests on a
// tokenizer that is not exported: whole-token matching is what stops "ai" matching
// inside "available" and "go" inside "google". The tokenizer is therefore pinned
// THROUGH buildJobFitSignals, which is the only contract that matters anyway.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJobFitSignals, canonicalSkill } from "./skills.ts";
import type { GithubRepo } from "./client.ts";

function repo(over: Partial<GithubRepo> = {}): GithubRepo {
  return {
    name: "repo",
    full_name: "octocat/repo",
    html_url: "https://github.com/octocat/repo",
    description: null,
    fork: false,
    stargazers_count: 0,
    forks_count: 0,
    language: null,
    updated_at: "2026-06-01T00:00:00.000Z",
    pushed_at: "2026-06-01T00:00:00.000Z",
    topics: [],
    size: 0,
    open_issues_count: 0,
    ...over,
  };
}

/** The comparison as the analysis runs it: complete language coverage unless a test
 *  is specifically about a throttled read. */
const fit = (jd: string, repos: GithubRepo[] = [], languages: Array<{ name: string; percent: number }> = [], complete = true) =>
  buildJobFitSignals(jd, repos, languages, complete);

// --- tokenizer edge cases ----------------------------------------------------

test("a short alias never phantom-matches inside a longer word", () => {
  // "ai" inside "available", "ts" inside "artefacts", "ci" inside "official",
  // "go" inside "google" — the substring bug this tokenizer exists to prevent.
  const r = fit("Must be available to work on official artefacts using google products.");
  assert.deepEqual(r.matchingSkills, []);
  assert.deepEqual(r.potentialGaps, [], "no skill is even CLAIMED by that sentence");
});

test("tech symbols survive tokenization: c#, c++ and node.js are real tokens", () => {
  assert.deepEqual(fit("We need c# and c++.").potentialGaps.sort(), ["cpp", "csharp"]);
  assert.deepEqual(fit("node.js required").potentialGaps, ["javascript"]);
  // …and the symbols are not interchangeable with their bare letters.
  assert.deepEqual(fit("We use the letter c a lot.").potentialGaps, []);
});

test("sentence punctuation is stripped, so a trailing dot does not hide a skill", () => {
  assert.deepEqual(fit("Experience with AI.").potentialGaps, ["ai"]);
  assert.deepEqual(fit("Strong TypeScript, Rust; and Go!").potentialGaps.sort(), ["go", "rust", "typescript"]);
});

test("matching is case-insensitive on both sides", () => {
  const r = fit("PYTHON expertise", [repo({ language: "Python" })]);
  assert.deepEqual(r.matchingSkills, ["python"]);
  assert.deepEqual(r.potentialGaps, []);
});

test("a multi-word alias needs EVERY word present, not just one", () => {
  assert.deepEqual(fit("We use github actions.").potentialGaps, ["ci"]);
  // "actions" alone is not the alias; nothing may be credited from half of it.
  assert.deepEqual(fit("We take actions.").potentialGaps, []);
});

// --- match / gap semantics ---------------------------------------------------

test("a skill in the JD and in the evidence is a match; in the JD only, a gap", () => {
  const r = fit(
    "Looking for python and rust.",
    [repo({ name: "svc", description: "a python service", language: "Python" })],
    [{ name: "Python", percent: 100 }],
  );
  assert.deepEqual(r.matchingSkills, ["python"]);
  assert.deepEqual(r.potentialGaps, ["rust"]);
});

test("evidence the JD never asked for is neither a match nor a gap", () => {
  const r = fit("python please", [repo({ language: "Rust", topics: ["kubernetes"] })]);
  assert.ok(!r.matchingSkills.includes("rust"), "unasked-for evidence is not a 'match'");
  assert.ok(!r.potentialGaps.includes("rust"), "…and certainly not a gap");
});

test("one underlying skill produces at most ONE verdict (the disjoint-bucket rule)", () => {
  // "react" used to live in the typescript + javascript + react buckets, so a single
  // React requirement fanned out into three gap bullets and a React-only candidate
  // into three apparent matches.
  const gaps = fit("We need React and Next.js.").potentialGaps;
  assert.deepEqual(gaps, ["react"], `one skill, one verdict; saw ${JSON.stringify(gaps)}`);
});

test("jobDescriptionProvided separates 'no JD supplied' from 'genuine zero overlap'", () => {
  assert.equal(fit("").jobDescriptionProvided, false);
  assert.equal(fit("   \n\t ").jobDescriptionProvided, false, "whitespace is not a JD");
  const zero = fit("We need cobol.", [repo({ language: "Python" })]);
  assert.equal(zero.jobDescriptionProvided, true);
  assert.deepEqual(zero.matchingSkills, [], "a real JD with no overlap: empty, but ASKED");
});

test("under partial language coverage gaps are dropped while found matches survive", () => {
  const r = fit(
    "We need typescript and rust.",
    [repo({ language: "TypeScript" })],
    [{ name: "TypeScript", percent: 100 }],
    false,
  );
  assert.deepEqual(r.matchingSkills, ["typescript"], "throttling can only REMOVE evidence");
  assert.deepEqual(r.potentialGaps, [], "a gap must never be asserted from missing data");
});

test("the tracked-skill count is reported so 'no gaps' can be stated honestly", () => {
  const r = fit("anything");
  assert.ok(r.trackedSkillCount > 20, "the taxonomy is the expanded disjoint set, not the old 10");
  assert.equal(typeof r.complexityAssessment.kind, "string", "the assessment rides along as a finding");
});

test("a Vue JD matches a vue repo and gaps a react-only repo", () => {
  const matched = fit("We need Vue.", [repo({ language: "Vue", topics: ["vue"] })]);
  assert.deepEqual(matched.matchingSkills, ["vue"]);
  assert.ok(!matched.potentialGaps.includes("vue"));

  const gapped = fit("We need Vue.", [repo({ language: "JavaScript", topics: ["react"] })]);
  assert.ok(!gapped.matchingSkills.includes("vue"));
  assert.ok(gapped.potentialGaps.includes("vue"), "a Vue JD vs a react-only repo must surface vue as a gap");
  assert.ok(!gapped.potentialGaps.includes("javascript"), "vue is disjoint from javascript");
});

test("vue.js in a JD is the vue bucket, not a silent miss", () => {
  assert.deepEqual(fit("Vue.js and Nuxt required.").potentialGaps.sort(), ["vue"]);
});

test("a Svelte JD matches sveltekit evidence", () => {
  const matched = fit("Svelte required", [repo({ name: "app", topics: ["sveltekit"] })]);
  assert.deepEqual(matched.matchingSkills, ["svelte"]);
  assert.deepEqual(matched.potentialGaps, []);
});

// --- per-repo attribution + the canonical vocabulary (challenge-r04 github-repo-intelligence/B)

test("each matched skill names the repo(s) whose labels produced it", () => {
  const r = fit("React and Go required", [
    repo({ name: "ui-kit", topics: ["react"] }),
    repo({ name: "svc", language: "Go" }),
  ]);
  assert.deepEqual(r.matchingSkills.sort(), ["go", "react"]);
  assert.deepEqual(r.skillEvidence, { react: ["ui-kit"], go: ["svc"] });
});

test("a skill evidenced only by the aggregate language mix is a match with no repo to name", () => {
  const r = fit("python", [repo({ name: "misc" })], [{ name: "Python", percent: 100 }]);
  assert.deepEqual(r.matchingSkills, ["python"]);
  assert.deepEqual(r.skillEvidence, { python: [] }, "never a repo that did not carry the label");
});

test("a partial run keeps the JD skills it could not determine instead of dropping them", () => {
  const r = fit("We need typescript and rust.", [repo({ name: "web", language: "TypeScript" })], [], false);
  assert.deepEqual(r.potentialGaps, [], "still no gap asserted from missing data");
  assert.deepEqual(r.undeterminedSkills, ["rust"]);
  assert.deepEqual(fit("We need rust.").undeterminedSkills, [], "a complete run determines everything");
});

test("canonicalSkill maps free text onto the disjoint taxonomy, and nothing else", () => {
  assert.equal(canonicalSkill("TypeScript"), "typescript");
  assert.equal(canonicalSkill("Next.js"), "react");
  assert.equal(canonicalSkill("Kubernetes (Helm)"), "kubernetes");
  assert.equal(canonicalSkill("Docker"), "docker");
  assert.equal(canonicalSkill("event sourcing"), null, "free text outside the taxonomy stays free text");
  assert.equal(canonicalSkill("Python and Rust"), null, "a phrase spanning two buckets is never forced into one");
  assert.equal(canonicalSkill(""), null);
});
