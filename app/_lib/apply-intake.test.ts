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
  normalizeApplicantName,
  applyDedupeKey,
  isRetryableApplyStatus,
  nextVisibleStepIndex,
  stepConditionMet,
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

// ---------------------------------------------------------------------------
// buildIntakeProfile — the early-career lanes. A student's answers become TYPED
// evidence + the profile fields the early-career completeness checklist requires;
// a switcher's prior field stays skill-free job evidence (it feeds transferable
// meta-skills, and target-domain claims must not inherit professional provenance).
// ---------------------------------------------------------------------------

const studentAnswers = {
  name: "Bea",
  skills: "Python, SQL",
  archetype: "student",
  studentProject: "Bachelor thesis: built a small REST API for lab scheduling",
  studentEducation: "Computer Science at CTU, graduating June 2027",
  studentAspirations: "junior backend developer",
};

test("student lane: project/thesis becomes project evidence carrying the skills", () => {
  const profile = buildIntakeProfile(baseJob, studentAnswers);
  const evidence = profile.evidence as Array<{ kind: string; title: string; text: string; skills: string[] }>;
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].kind, "project");
  assert.match(evidence[0].title, /thesis/i);
  assert.deepEqual(evidence[0].skills, ["Python", "SQL"]);
});

test("student lane: education detail and aspirations land as profile fields", () => {
  const profile = buildIntakeProfile(baseJob, studentAnswers);
  assert.equal(profile.educationDetail, "Computer Science at CTU, graduating June 2027");
  assert.deepEqual(profile.aspirations, ["junior backend developer"]);
});

test("student lane: years inside a project description are NOT tenure", () => {
  const profile = buildIntakeProfile(baseJob, {
    ...studentAnswers,
    studentProject: "2 years of weekend work on my thesis robot",
  });
  assert.ok(!("yearsExperience" in profile));
});

const switcherAnswers = {
  name: "Cyril",
  skills: "Python, SQL",
  archetype: "career_switcher",
  switchPrior: "6 years in finance as an analyst",
  switchAspirations: "moving into data engineering",
};

test("switcher lane: prior field is job evidence WITHOUT the claimed skills", () => {
  const profile = buildIntakeProfile(baseJob, switcherAnswers);
  const evidence = profile.evidence as Array<{ kind: string; skills: string[] }>;
  const job = evidence.find((e) => e.kind === "job");
  assert.ok(job, "prior field must land as job evidence");
  assert.deepEqual(job?.skills, []);
});

test("switcher lane: claimed skills ride a separate non-job evidence item", () => {
  const profile = buildIntakeProfile(baseJob, switcherAnswers);
  const evidence = profile.evidence as Array<{ kind: string; skills: string[] }>;
  const other = evidence.find((e) => e.kind === "other");
  assert.deepEqual(other?.skills, ["Python", "SQL"]);
});

test("switcher lane: tenure parses from the prior-field answer", () => {
  const profile = buildIntakeProfile(baseJob, switcherAnswers);
  assert.equal(profile.yearsExperience, 6);
  assert.deepEqual(profile.aspirations, ["moving into data engineering"]);
});

test("no lane captured anything → the default evidence item still exists", () => {
  const profile = buildIntakeProfile(baseJob, { name: "Dan", skills: "Go" });
  const evidence = profile.evidence as Array<{ kind: string; text: string }>;
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].text, "—");
});

// ---------------------------------------------------------------------------
// stepConditionMet / nextVisibleStepIndex — the lane router. These decide which
// intake questions a student vs an experienced applicant actually sees, and how
// the flow degrades when the archetype question was never offered.
// ---------------------------------------------------------------------------

const LANED_SCRIPT = [
  { id: "name" },
  { id: "archetype" },
  { id: "student_q", when: { stepId: "archetype", oneOf: ["student"] } },
  { id: "experience", when: { stepId: "archetype", notOneOf: ["student", "career_switcher"] } },
  { id: "skills" },
];

test("a step with no condition is always visible", () => {
  assert.equal(stepConditionMet(undefined, {}), true);
});

test("oneOf shows the step only for a matching answer", () => {
  const when = { stepId: "archetype", oneOf: ["student"] };
  assert.equal(stepConditionMet(when, { archetype: "student" }), true);
  assert.equal(stepConditionMet(when, { archetype: "bau" }), false);
  assert.equal(stepConditionMet(when, {}), false);
});

test("notOneOf shows the step for other answers AND when the answer is absent", () => {
  const when = { stepId: "archetype", notOneOf: ["student"] };
  assert.equal(stepConditionMet(when, { archetype: "bau" }), true);
  assert.equal(stepConditionMet(when, {}), true);
  assert.equal(stepConditionMet(when, { archetype: "student" }), false);
});

test("a student walks the student lane and skips the experience question", () => {
  const answers = { archetype: "student" };
  assert.equal(nextVisibleStepIndex(LANED_SCRIPT, 1, answers), 2); // → student_q
  assert.equal(nextVisibleStepIndex(LANED_SCRIPT, 2, answers), 4); // → skills (experience skipped)
});

test("an experienced applicant skips the student lane", () => {
  const answers = { archetype: "bau" };
  assert.equal(nextVisibleStepIndex(LANED_SCRIPT, 1, answers), 3); // → experience
});

test("with the archetype question never offered, the default lane shows", () => {
  // No archetype answer at all (registry exposed <2 options): the student lane
  // can't match, the notOneOf default lane does.
  assert.equal(nextVisibleStepIndex(LANED_SCRIPT, 0, {}), 1);
  assert.equal(nextVisibleStepIndex(LANED_SCRIPT, 1, {}), 3);
});

test("returns -1 past the last visible step (the submit signal)", () => {
  assert.equal(nextVisibleStepIndex(LANED_SCRIPT, 4, { archetype: "student" }), -1);
});

// ---------------------------------------------------------------------------
// normalizeApplicantName / applyDedupeKey — the duplicate-application identity.
// These pin the key the apply flow dedups repeat applications on (jobId + name),
// since the flow captures no contact field. See route.ts + db.ts.
// ---------------------------------------------------------------------------

test("normalizeApplicantName lowercases, trims, and collapses inner whitespace", () => {
  assert.equal(normalizeApplicantName("  Jane   DOE "), "jane doe");
});

test("normalizeApplicantName treats casing/spacing variants of one name as equal", () => {
  assert.equal(normalizeApplicantName("Jane Doe"), normalizeApplicantName("jane  doe"));
});

test("normalizeApplicantName returns empty string for a blank/whitespace name", () => {
  assert.equal(normalizeApplicantName("   "), "");
  assert.equal(normalizeApplicantName(""), "");
});

test("applyDedupeKey builds a slug-safe appl- key from the normalized name", () => {
  assert.equal(applyDedupeKey("Jane Doe"), "appl-jane-doe");
  assert.equal(applyDedupeKey("  Jane   DOE "), "appl-jane-doe");
});

test("applyDedupeKey is stable across casing/spacing variants of one applicant", () => {
  assert.equal(applyDedupeKey("Ada Lovelace"), applyDedupeKey("  ada   lovelace "));
});

test("applyDedupeKey returns empty string for a nameless applicant (no dedup)", () => {
  // A blank key is the signal to the caller NOT to dedup — two anonymous
  // applicants must not collapse onto one pipeline entry.
  assert.equal(applyDedupeKey(""), "");
  assert.equal(applyDedupeKey("   "), "");
});

test("applyDedupeKey distinguishes genuinely different names", () => {
  assert.notEqual(applyDedupeKey("Jane Doe"), applyDedupeKey("John Doe"));
});

test("applyDedupeKey keys on the email when given (the stronger identity)", () => {
  // Same name, DIFFERENT emails → DISTINCT keys (two real people, not a merge —
  // the bug the name-only key had).
  assert.notEqual(applyDedupeKey("Jane Doe", "jane1@x.com"), applyDedupeKey("Jane Doe", "jane2@x.com"));
  // Same email, different name casing/spelling → SAME key (one person).
  assert.equal(applyDedupeKey("Jane Doe", "jane@x.com"), applyDedupeKey("Jane D.", " JANE@X.com "));
});

test("applyDedupeKey email keys survive the slug strip without colliding", () => {
  // `@` and `.` become hyphens, so a.b@x.com and ab@x.com stay distinct (a plain
  // strip of non-alphanumerics would collapse both to 'abxcom').
  assert.notEqual(applyDedupeKey("X", "a.b@x.com"), applyDedupeKey("X", "ab@x.com"));
  assert.equal(applyDedupeKey("X", "a.b@x.com"), "appl-a-b-x-com");
});

test("applyDedupeKey falls back to the name when no email is captured", () => {
  assert.equal(applyDedupeKey("Jane Doe"), "appl-jane-doe");
  assert.equal(applyDedupeKey("Jane Doe", ""), "appl-jane-doe");
  assert.equal(applyDedupeKey("Jane Doe", "   "), "appl-jane-doe");
});

// ---------------------------------------------------------------------------
// isRetryableApplyStatus — the apply submit-failure recovery contract.
// Pins which failed-submit statuses can re-POST the same answers ("Try again")
// vs. must restart so the candidate can fix their input ("Start over"). See the
// contract doc in apply-intake.ts and the inline recovery UI in
// app/apply/[id]/ConversationalApply.tsx.
// ---------------------------------------------------------------------------

test("5xx server errors are retryable — a re-POST of the same answers can succeed", () => {
  assert.equal(isRetryableApplyStatus(500), true);
  assert.equal(isRetryableApplyStatus(502), true);
  assert.equal(isRetryableApplyStatus(503), true);
});

test("408 Request Timeout and 429 Too Many Requests are retryable (transient)", () => {
  assert.equal(isRetryableApplyStatus(408), true);
  assert.equal(isRetryableApplyStatus(429), true);
});

test("input-rejection 4xx are NOT retryable — resending the same payload loops", () => {
  // 400 answer-too-long, 413 payload-too-large, 404 role-gone: the server
  // rejected THIS input, so the candidate must restart rather than retry.
  assert.equal(isRetryableApplyStatus(400), false);
  assert.equal(isRetryableApplyStatus(404), false);
  assert.equal(isRetryableApplyStatus(413), false);
});

test("a 2xx is not classified as a retryable failure", () => {
  // Success is handled before classification ever runs; guard the boundary anyway.
  assert.equal(isRetryableApplyStatus(200), false);
});
