// The pipeline drawer's frozen GitHub evidence card. The review's `unverifiedClaims`
// are skills it did not SEE in public repo signals; public work can confirm a skill
// but never rule one out (registry: recruiting/public-work-evidence-bounding,
// corroborate-a-claim-never-replace-it). So the list is labelled neutrally, never as
// "unverified claims", and never in an accusatory token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GITHUB_NOT_SEEN_CLASS,
  GITHUB_NOT_SEEN_KEY,
  GITHUB_NOT_SEEN_TITLE_KEY,
  notSeenInPublicRepos,
} from "./PipelineCandidateDrawerTypes.ts";

const ACCUSATORY = /\b(?:bg|text|border)-(?:coral|amber|red)(?:-\d+)?\b/;

test("the not-seen label is a neutral token", () => {
  assert.doesNotMatch(GITHUB_NOT_SEEN_CLASS, ACCUSATORY);
  assert.match(GITHUB_NOT_SEEN_CLASS, /text-steel/);
});

test("a skill the review also evidenced is not listed as not seen", () => {
  const out = notSeenInPublicRepos({ confirmedSkills: ["TypeScript", "Go"], unverifiedClaims: ["typescript", "Rust", " ", "rust"] });
  assert.deepEqual(out, ["Rust"]);
});

test("an empty list stays empty", () => {
  assert.deepEqual(notSeenInPublicRepos({ confirmedSkills: [], unverifiedClaims: [] }), []);
});

test("the copy in every locale never calls the list unverified or claims", () => {
  const banned: Record<string, RegExp> = {
    en: /unverified|claim/i,
    cs: /neověřen|tvrzen/i,
    de: /unbestätigt|nicht verifiziert|behauptung/i,
    fr: /non vérifié|affirmation|prétention/i,
  };
  for (const locale of ["en", "cs", "de", "fr"]) {
    const drawer = JSON.parse(readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8")).pipeline.drawer;
    for (const key of [GITHUB_NOT_SEEN_KEY, GITHUB_NOT_SEEN_TITLE_KEY]) {
      assert.equal(typeof drawer[key], "string", `${locale}: ${key}`);
      assert.doesNotMatch(drawer[key], banned[locale], `${locale}: ${key}`);
    }
    assert.equal(drawer.githubUnverified, undefined, `${locale}: the accusatory key is gone`);
  }
});

test("the card renders the list through the helper, with no amber label", () => {
  const src = readFileSync(join(process.cwd(), "app/features/hiring/pipeline/PipelineGithubEvidenceCard.tsx"), "utf8");
  assert.match(src, /notSeenInPublicRepos\(/);
  assert.match(src, /GITHUB_NOT_SEEN_CLASS/);
  assert.doesNotMatch(src, /githubUnverified/);
  assert.doesNotMatch(src, /text-amber/);
});
