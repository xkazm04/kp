// Pins the completeness follow-up merge: which answers become which profile
// fields/evidence, that blank answers change nothing, and that the transient
// completenessGaps key never survives into the saved payload. The checklist
// itself (which gaps exist) is Python's — see profile.completeness_gaps and
// test_profile.py; this only locks the TS half of the loop.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { GAP_FIELDS, mergeGapAnswers } from "./completeness-followup.ts";

const analyzed = {
  archetype: "student",
  displayName: "Bea",
  languages: ["Czech"],
  skillClaims: [{ skill: "Python", provenance: "coursework" }],
  evidence: [{ kind: "course", title: "Databases", text: "", skills: ["SQL"] }],
  completenessGaps: [
    { check: "has_project_or_thesis", label: "A project or thesis with what YOU did" },
    { check: "has_aspirations", label: "What roles you're aiming for" },
  ],
};

test("the transient completenessGaps key is always stripped", () => {
  const merged = mergeGapAnswers(analyzed, {});
  assert.ok(!("completenessGaps" in merged));
});

test("no answers → the profile is otherwise unchanged", () => {
  const merged = mergeGapAnswers(analyzed, {});
  assert.equal(merged.displayName, "Bea");
  assert.deepEqual(merged.evidence, analyzed.evidence);
  assert.deepEqual(merged.languages, ["Czech"]);
});

test("the input never mutates", () => {
  const before = JSON.stringify(analyzed);
  mergeGapAnswers(analyzed, { has_project_or_thesis: "My thesis" });
  assert.equal(JSON.stringify(analyzed), before);
});

test("a project answer becomes typed project evidence", () => {
  const merged = mergeGapAnswers(analyzed, { has_project_or_thesis: "Bachelor thesis: lab scheduling API" });
  const evidence = merged.evidence as Array<{ kind: string; text: string }>;
  assert.equal(evidence.length, 2);
  assert.equal(evidence[1].kind, "project");
  assert.equal(evidence[1].text, "Bachelor thesis: lab scheduling API");
});

test("activity and job answers become their own evidence kinds", () => {
  const merged = mergeGapAnswers(analyzed, {
    has_activity: "Robotics club lead",
    has_job: "Part-time web developer",
  });
  const kinds = (merged.evidence as Array<{ kind: string }>).map((e) => e.kind);
  assert.deepEqual(kinds, ["course", "extracurricular", "job"]);
});

test("aspirations append; education fields set", () => {
  const merged = mergeGapAnswers(
    { ...analyzed, aspirations: ["data analyst"] },
    { has_aspirations: "junior backend developer", has_education_detail: "CS at CTU, 2027", education_known: "Bachelor" }
  );
  assert.deepEqual(merged.aspirations, ["data analyst", "junior backend developer"]);
  assert.equal(merged.educationDetail, "CS at CTU, 2027");
  assert.equal(merged.educationLevel, "bachelor"); // normalized to lowercase
});

test("languages extend without case-insensitive duplicates", () => {
  const merged = mergeGapAnswers(analyzed, { has_languages: "czech, English; German" });
  assert.deepEqual(merged.languages, ["Czech", "English", "German"]);
});

test("skills become self_declared claims, never duplicating existing ones", () => {
  const merged = mergeGapAnswers(analyzed, { min_3_skills: "python, SQL, Git" });
  const claims = merged.skillClaims as Array<{ skill: string; provenance?: string }>;
  assert.deepEqual(
    claims.map((c) => c.skill),
    ["Python", "SQL", "Git"]
  );
  assert.equal(claims[1].provenance, "self_declared");
});

test("years parse only from a real non-negative number", () => {
  assert.equal(mergeGapAnswers(analyzed, { has_years: "4" }).yearsExperience, 4);
  assert.equal(mergeGapAnswers(analyzed, { has_years: "0" }).yearsExperience, 0);
  assert.ok(!("yearsExperience" in mergeGapAnswers(analyzed, { has_years: "four-ish" })));
  assert.ok(!("yearsExperience" in mergeGapAnswers(analyzed, { has_years: "-2" })));
});

test("blank/whitespace answers are ignored", () => {
  const merged = mergeGapAnswers(analyzed, { has_project_or_thesis: "   ", has_aspirations: "" });
  assert.equal((merged.evidence as unknown[]).length, 1);
  assert.ok(!("aspirations" in merged));
});

test("every student + BAU checklist predicate has a form field", () => {
  // The checklist ids live in pipeline/jobfit/archetypes.json; profile.py CHECKS
  // implements them. This pins that the follow-up form can collect for each one,
  // so a gap never renders as a label with no input.
  for (const check of [
    "has_project_or_thesis",
    "has_aspirations",
    "has_education_detail",
    "has_activity",
    "education_known",
    "has_languages",
    "min_3_skills",
    "has_years",
    "has_job",
  ]) {
    assert.ok(GAP_FIELDS[check], `GAP_FIELDS is missing "${check}"`);
  }
});
