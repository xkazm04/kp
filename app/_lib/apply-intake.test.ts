// Unit tests pinning the conversational-apply intake heuristics that used to be
// undocumented tribal knowledge: the bilingual years-of-experience parser and
// the default language locale. See the contract docs on `parseYearsExperience`
// and `DEFAULT_APPLY_LANGUAGES` in apply-intake.ts — these lock the boundary
// behavior so it stays predictable as the apply prompt copy evolves.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseYearsExperience,
  buildIntakeProfile,
  DEFAULT_APPLY_LANGUAGES,
} from "./apply-intake.ts";
import type { JobRecord } from "./db.ts";

// ---------------------------------------------------------------------------
// parseYearsExperience — what it CAPTURES
// ---------------------------------------------------------------------------

test("captures plain English years", () => {
  assert.equal(parseYearsExperience("3 years building Node.js APIs"), 3);
});

test("captures the `yrs` abbreviation", () => {
  assert.equal(parseYearsExperience("about 8 yrs in frontend"), 8);
});

test("captures a number with a trailing plus", () => {
  assert.equal(parseYearsExperience("5+ years of React"), 5);
});

test("captures a plus separated by a space", () => {
  assert.equal(parseYearsExperience("10 + years leading teams"), 10);
});

test("is case-insensitive", () => {
  assert.equal(parseYearsExperience("4 YEARS"), 4);
});

test("captures Czech `let`", () => {
  assert.equal(parseYearsExperience("7 let praxe v Javě"), 7);
});

test("captures Czech `roky`", () => {
  assert.equal(parseYearsExperience("mám 3 roky zkušeností"), 3);
});

test("captures Czech `rok` (singular)", () => {
  assert.equal(parseYearsExperience("1 rok jako junior"), 1);
});

test("captures inflected Czech forms via prefix match (`lety`)", () => {
  // The Czech tokens match as a prefix, so "lety" is caught through "let".
  assert.equal(parseYearsExperience("před 5 lety jsem začal"), 5);
});

test("captures an explicit zero (kept, not dropped)", () => {
  assert.equal(parseYearsExperience("0 years, fresh graduate"), 0);
});

test("captures the integer adjacent to the unit in a range", () => {
  // "5 to 8 years" — only the digit directly before the unit is taken.
  assert.equal(parseYearsExperience("5 to 8 years"), 8);
});

test("captures the first qualifying match when several appear", () => {
  assert.equal(parseYearsExperience("2 years here, 9 years there"), 2);
});

// ---------------------------------------------------------------------------
// parseYearsExperience — what it IGNORES (returns undefined)
// ---------------------------------------------------------------------------

test("ignores word-only quantities with no digit", () => {
  assert.equal(parseYearsExperience("a couple of years"), undefined);
});

test("ignores 'several years'", () => {
  assert.equal(parseYearsExperience("several years of experience"), undefined);
});

test("ignores sub-year units like months", () => {
  assert.equal(parseYearsExperience("6 months as an intern"), undefined);
});

test("ignores sub-year units like weeks", () => {
  assert.equal(parseYearsExperience("18 weeks bootcamp"), undefined);
});

test("ignores 3+ digit numbers (out of the supported 0–99 range)", () => {
  // Guards the old quirk where "100 years" silently captured the sub-string "00".
  assert.equal(parseYearsExperience("100 years"), undefined);
});

test("ignores a bare number with no adjacent unit", () => {
  assert.equal(parseYearsExperience("joined in 2019"), undefined);
});

test("ignores empty input", () => {
  assert.equal(parseYearsExperience(""), undefined);
});

// ---------------------------------------------------------------------------
// buildIntakeProfile — locale default + years wiring
// ---------------------------------------------------------------------------

const baseJob: JobRecord = { id: "job-1", title: "Engineer" };
const baseAnswers = { name: "Ada", experience: "3 years of Rust", skills: "Rust, SQL" };

test("DEFAULT_APPLY_LANGUAGES is the documented Czech/English bilingual default", () => {
  assert.deepEqual([...DEFAULT_APPLY_LANGUAGES], ["Czech", "English"]);
});

test("falls back to DEFAULT_APPLY_LANGUAGES when the job declares none", () => {
  const profile = buildIntakeProfile(baseJob, baseAnswers);
  assert.deepEqual(profile.languages, [...DEFAULT_APPLY_LANGUAGES]);
});

test("prefers the job's declared languages over the default", () => {
  const job: JobRecord = { ...baseJob, languages: ["German"] };
  const profile = buildIntakeProfile(job, baseAnswers);
  assert.deepEqual(profile.languages, ["German"]);
});

test("sets yearsExperience from the experience text", () => {
  const profile = buildIntakeProfile(baseJob, baseAnswers);
  assert.equal(profile.yearsExperience, 3);
});

test("keeps an explicit zero years on the profile", () => {
  const profile = buildIntakeProfile(baseJob, { ...baseAnswers, experience: "0 years" });
  assert.equal(profile.yearsExperience, 0);
  assert.ok("yearsExperience" in profile);
});

test("omits yearsExperience when the text has no parseable years", () => {
  const profile = buildIntakeProfile(baseJob, { ...baseAnswers, experience: "6 months" });
  assert.ok(!("yearsExperience" in profile));
});

test("splits skills on commas and semicolons into evidence", () => {
  const profile = buildIntakeProfile(baseJob, { ...baseAnswers, skills: "Rust, SQL; Go" });
  const evidence = profile.evidence as Array<{ skills: string[] }>;
  assert.deepEqual(evidence[0].skills, ["Rust", "SQL", "Go"]);
});
