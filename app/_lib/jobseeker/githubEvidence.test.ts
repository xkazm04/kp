import assert from "node:assert/strict";
import { test } from "node:test";
import { cvProfile, githubStateOf, matcherProfile, usableEvidence, type GithubState } from "./githubEvidence.ts";
import type { JobseekerProfile } from "./types.ts";

const REPO = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  fullName: `octo/${name}`,
  htmlUrl: `https://github.com/octo/${name}`,
  description: `${name} does one thing well`,
  language: "TypeScript",
  topics: ["nextjs"],
  stars: 3,
  pushedAt: "2026-08-01T10:00:00Z",
  createdAt: "2024-02-01T10:00:00Z",
  archived: false,
  ...over,
});

const STORED = {
  handle: "octo",
  login: "octo",
  name: "Octo Cat",
  htmlUrl: "https://github.com/octo",
  publicRepos: 3,
  readAt: "2026-09-28T10:00:00Z",
  confirmed: true,
  use: true,
  projects: ["alpha", "ghost-repo"],
  repos: [REPO("alpha"), REPO("beta", { description: null, language: "Python" })],
  derived: {
    evidence: [
      { kind: "project", title: "alpha", text: "alpha does one thing well\nStack: TypeScript, Next.js", skills: ["TypeScript", "Next.js"], link: "https://github.com/octo/alpha", recency: "2026-08", provenance: "personal_project", repo: "alpha" },
      { kind: "project", title: "beta", text: "Stack: Python", skills: ["Python"], link: "https://github.com/octo/beta", recency: "2026-08", provenance: "personal_project", repo: "beta" },
      { kind: "project", title: "no skills", text: "", skills: [], link: "https://github.com/octo/x", recency: null, provenance: "personal_project", repo: "x" },
    ],
    skills: [{ skill: "TypeScript", termId: "typescript", repos: 1, lastPushedAt: "2026-08-01T10:00:00Z", corroborates: true }],
    budget: { repos: 2, languageReads: { planned: 2, read: 1 }, partial: true, truncated: false },
  },
};

const PROFILE: JobseekerProfile = {
  id: "p1",
  profile: { displayName: "Octo", skillClaims: [{ skill: "TypeScript", level: "strong", provenance: "professional" }], evidence: [{ kind: "job", title: "Engineer at Acme" }] },
  preferences: {},
  updatedAt: "2026-09-01T00:00:00Z",
} as unknown as JobseekerProfile;

test("a stored state is re-validated: unknown projects, skill-less evidence and foreign links are dropped", () => {
  const s = githubStateOf(STORED)!;
  assert.deepEqual(s.projects, ["alpha"], "a project must be one of the snapshot's repositories");
  assert.deepEqual(s.derived.evidence.map((e) => e.repo), ["alpha", "beta"], "evidence with no skill is not evidence");
  assert.equal(s.derived.budget.partial, true);
  assert.equal(githubStateOf({ ...STORED, htmlUrl: undefined }), null);
  assert.equal(githubStateOf(null), null);
  const foreign = githubStateOf({ ...STORED, repos: [REPO("evil", { htmlUrl: "https://evil.example/octo" })] })!;
  assert.deepEqual(foreign.repos, [], "only github.com links are kept");
});

test("nothing reaches the matcher before the identity gate and the seeker's own choice", () => {
  const s = githubStateOf(STORED)!;
  assert.equal(usableEvidence({ ...s, confirmed: false }).length, 0, "not confirmed as theirs");
  assert.equal(usableEvidence({ ...s, use: false }).length, 0, "not chosen for matching");
  assert.equal(usableEvidence(null).length, 0);
  assert.equal(usableEvidence(s).length, 2);
});

test("the matcher's view adds personal_project evidence beside the CV's own and never removes anything", () => {
  const s = githubStateOf(STORED)!;
  const view = matcherProfile(PROFILE, s, "2026-09-28T11:00:00Z");
  assert.equal(view.profile.evidence?.length, 3, "the CV's job stays, two repositories join it");
  assert.deepEqual(view.profile.skillClaims, PROFILE.profile.skillClaims, "claims are never touched");
  const added = view.profile.evidence![1] as Record<string, unknown>;
  assert.equal(added.provenance, "personal_project");
  assert.equal(added.link, "https://github.com/octo/alpha");
  assert.equal(view.updatedAt, "2026-09-28T11:00:00Z", "a saved choice moves the inputs time, so the scan re-scores");
});

test("no GitHub, or a choice older than the profile, leaves the profile exactly as it was", () => {
  assert.equal(matcherProfile(PROFILE, null, null), PROFILE);
  const off = { ...githubStateOf(STORED)!, use: false };
  assert.equal(matcherProfile(PROFILE, off, "2026-08-01T00:00:00Z"), PROFILE);
  const offLater = matcherProfile(PROFILE, off, "2026-09-28T11:00:00Z");
  assert.equal(offLater.profile.evidence?.length, 1, "turned off: nothing added");
  assert.equal(offLater.updatedAt, "2026-09-28T11:00:00Z", "but turning it off is still an input change");
});

test("the CV's view carries only the chosen repositories, named with the link and years", () => {
  const s = githubStateOf({ ...STORED, projects: ["beta", "alpha"] })!;
  const cv = cvProfile(PROFILE.profile, s);
  const added = (cv.evidence ?? []).slice(1);
  assert.deepEqual(
    added.map((e) => e.title),
    ["beta — github.com/octo/beta (2024 – 2026)", "alpha — github.com/octo/alpha (2024 – 2026)"],
    "in the seeker's order, each titled so cvDocument reads Role — Org (dates)"
  );
  assert.equal(added[0]!.text, "Stack: Python.", "a repository with no description says only its stack");
  assert.match(added[1]!.text ?? "", /^alpha does one thing well\.\nStack: TypeScript, Next\.js\.$/, "the repository's sentence is closed, so the stack is its own bullet");
  assert.equal(cvProfile(PROFILE.profile, { ...s, confirmed: false }), PROFILE.profile, "never before the identity gate");
  assert.equal(cvProfile(PROFILE.profile, { ...s, projects: [] }), PROFILE.profile);
});

test("a state with no usable shape reads as none", () => {
  const s: GithubState | null = githubStateOf({ handle: "x" });
  assert.equal(s, null);
});
