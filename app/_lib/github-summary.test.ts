import { test } from "node:test";
import assert from "node:assert/strict";
import { coerceGithubEvidenceSummary, type GithubEvidenceSummary } from "./github-summary.ts";

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
