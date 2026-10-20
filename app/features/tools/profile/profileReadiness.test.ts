// The editor's live readiness: archetype routing and the completeness checklist,
// evaluated in the browser from the form in memory while the recruiter types.
//
// Two engines now read archetypes.json - profile_cli (Python, the save's authority)
// and profileReadiness.ts (this port, the preview). They are held together by ONE
// shared case file, pipeline/jobfit/tests/profile_readiness_cases.json: this suite
// runs the TS port over it, test_profile_readiness_parity.py runs profile_cli over
// it, and a rule changed on one side only turns one of the two red.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import registry from "@/pipeline/jobfit/archetypes.json";
import type { ArchetypeDef, SkillRow, EvidenceRow } from "@/app/features/shared/profileTypes";
import {
  CHECK_PREDICATES,
  pyRound2,
  readiness,
  readinessFromRequest,
  readinessSignals,
  type ReadinessForm,
} from "./profileReadiness.ts";

const ROOT = new URL("../../../../", import.meta.url);
const readText = (rel: string) => readFileSync(fileURLToPath(new URL(rel, ROOT)), "utf8").replace(/\r\n/g, "\n");

type Case = {
  name: string;
  customArchetypes?: ArchetypeDef[];
  input: { profile: Record<string, unknown>; signals: Record<string, unknown> };
  expected: {
    archetype: string;
    confidence: number;
    reasonCodes: { kind: string; params: Record<string, unknown> }[];
    completeness: number;
    missingGaps: { check: string; label: string }[];
  };
};
const CASES: Case[] = JSON.parse(readText("pipeline/jobfit/tests/profile_readiness_cases.json")).cases;

// What ProfileTab's /api/archetypes fetch hands the editor: the registry's archetypes.
const BUILT_IN = (registry as { archetypes: ArchetypeDef[] }).archetypes;

const skill = (name: string): SkillRow => ({ skill: name, level: "working", provenance: "self_declared", _id: name });
const blankForm = (over: Partial<ReadinessForm> = {}): ReadinessForm => ({
  displayName: "",
  roleFamily: "general_professional",
  educationLevel: "unknown",
  educationDetail: "",
  languages: "",
  location: "",
  availability: "",
  aspirations: "",
  // The editor always renders one empty row of each; an empty row is not a claim.
  skills: [skill("")],
  evidence: [{ kind: "project", title: "", text: "", skills: "", link: "", _id: "e" } as EvidenceRow],
  choice: "auto",
  yearsExperience: "",
  seniority: "",
  isEnrolled: false,
  expectedGraduation: "",
  wantsDomainChange: false,
  hasSubstantialExperience: false,
  ...over,
});

const byCase = (name: string) => {
  const c = CASES.find((x) => x.name === name);
  assert.ok(c, `case ${name} must stay in the shared file`);
  return c;
};

test("a blank auto form routes to the default and opens every bau + common gap, biggest first", () => {
  const r = readiness(blankForm(), BUILT_IN);
  assert.equal(r.archetype, "bau");
  assert.equal(r.confidence, 0.4);
  assert.deepEqual(r.reasonCodes, [{ kind: "default", params: {} }]);
  assert.equal(r.completeness, 0);
  const expected = byCase("blank_auto").expected;
  assert.deepEqual(r.missingGaps.map((g) => g.check), expected.missingGaps.map((g) => g.check));
  const everyCheck = [...registry.commonChecklist, ...BUILT_IN.find((a) => a.id === "bau")!.checklist].map((s) => s.check);
  assert.deepEqual(new Set(r.missingGaps.map((g) => g.check)), new Set(everyCheck));
});

test("a declared student with 3 skills, a language and an education level: self-declared 0.9, those gaps closed", () => {
  const r = readiness(
    blankForm({
      choice: "student",
      skills: [skill("Python"), skill("SQL"), skill("Git")],
      languages: "Czech",
      educationLevel: "bachelor",
    }),
    BUILT_IN
  );
  assert.equal(r.archetype, "student");
  assert.equal(r.confidence, 0.9);
  assert.deepEqual(r.reasonCodes[0], { kind: "self_declared", params: { archetype: "student" } });
  const open = r.missingGaps.map((g) => g.check);
  for (const closed of ["education_known", "has_languages", "min_3_skills"]) {
    assert.ok(!open.includes(closed), `${closed} is satisfied and must not be offered as a gap`);
  }
});

test("auto + currently enrolled + a graduation year routes to student unanimously, with the year as a param", () => {
  const r = readiness(blankForm({ isEnrolled: true, expectedGraduation: "2027" }), BUILT_IN);
  assert.equal(r.archetype, "student");
  assert.equal(r.confidence, 1);
  assert.deepEqual(r.reasonCodes, [
    { kind: "signal_enrolled", params: {} },
    { kind: "signal_expected_graduation", params: { expected_graduation: "2027" } },
  ]);
});

test("every shared case: the TS port says exactly what profile_cli says", () => {
  assert.ok(CASES.length >= 12, "the shared file is the whole parity contract - keep it broad");
  for (const c of CASES) {
    const archetypes = [...BUILT_IN, ...(c.customArchetypes ?? [])];
    const r = readinessFromRequest(c.input.profile, c.input.signals, archetypes);
    assert.deepEqual(
      {
        archetype: r.archetype,
        confidence: r.confidence,
        reasonCodes: r.reasonCodes,
        completeness: r.completeness,
        missingGaps: r.missingGaps.map(({ check, label }) => ({ check, label })),
      },
      c.expected,
      `case ${c.name}`
    );
  }
});

test("a years value typed under career_switcher is invisible once the choice is student (the save's own rule)", () => {
  // Under student the retained "5" must not reach the router: were it read, a
  // not-enrolled student with 5 years fires contradiction_student_experienced.
  const student = readiness(blankForm({ choice: "student", yearsExperience: "5" }), BUILT_IN);
  assert.deepEqual(student.reasonCodes, [{ kind: "self_declared", params: { archetype: "student" } }]);
  assert.equal(student.confidence, 0.9);
  // And auto hides years too: no yre_high signal, the default route.
  const auto = readiness(blankForm({ yearsExperience: "5" }), BUILT_IN);
  assert.deepEqual(auto.reasonCodes, [{ kind: "default", params: {} }]);
  // Where years IS visible it counts: bau's has_years closes.
  const bau = readiness(blankForm({ choice: "bau", yearsExperience: "5" }), BUILT_IN);
  assert.ok(!bau.missingGaps.some((g) => g.check === "has_years"));
});

test("a checklist item with an unknown check id counts as unmet (fail closed, as profile.py's CHECKS.get)", () => {
  const odd: ArchetypeDef = {
    ...BUILT_IN[0],
    id: "odd",
    checklist: [{ check: "not_a_real_check", weight: 3, label: "mystery" }],
  };
  const r = readiness(
    blankForm({ choice: "odd", educationLevel: "master", languages: "Czech", skills: [skill("A"), skill("B"), skill("C")] }),
    [...BUILT_IN, odd]
  );
  assert.deepEqual(r.missingGaps.map((g) => g.check), ["not_a_real_check"]);
  assert.equal(r.completeness, pyRound2(3.5 / 6.5));
});

test("the TS predicates implement exactly the CHECKS keys profile.py declares (lockstep)", () => {
  const py = readText("pipeline/jobfit/profile.py");
  const block = /^CHECKS: dict\[[^\n]*\] = \{\n([\s\S]*?)^\}/m.exec(py)?.[1];
  assert.ok(block, "profile.py must still declare the CHECKS table");
  const pyKeys = [...block.matchAll(/^\s+"([a-z0-9_]+)":\s*lambda/gm)].map((m) => m[1]).sort();
  assert.ok(pyKeys.length >= 10);
  assert.deepEqual(Object.keys(CHECK_PREDICATES).sort(), pyKeys);
});

test("each live gap carries the editor field that closes it, so Add next stays clickable", () => {
  const r = readiness(blankForm({ choice: "bau" }), BUILT_IN);
  const target = (check: string) => r.missingGaps.find((g) => g.check === check)?.target;
  assert.equal(target("min_3_skills"), "skills");
  assert.equal(target("has_seniority"), "seniority");
  assert.equal(target("has_job"), "evidence");
});

test("a custom archetype on the live prop but not in the built-in JSON routes self-declared 0.9 with its own (empty) checklist", () => {
  const apprentice: ArchetypeDef = { ...BUILT_IN[0], id: "apprentice", label: "Apprentice", badge: "App", checklist: [] };
  assert.ok(!BUILT_IN.some((a) => a.id === "apprentice"));
  const r = readiness(blankForm({ choice: "apprentice", languages: "German" }), [...BUILT_IN, apprentice]);
  assert.equal(r.archetype, "apprentice");
  assert.equal(r.confidence, 0.9);
  assert.deepEqual(r.reasonCodes, [{ kind: "self_declared", params: { archetype: "apprentice" } }]);
  assert.deepEqual(
    r.missingGaps.map((g) => g.check),
    ["min_3_skills", "education_known"],
    "only the common checks apply - the custom archetype declares none"
  );
  // Absent from the prop (the registry fetch has not landed), the same choice is not
  // a declaration the router knows: it falls back to auto, exactly as profile_cli does.
  assert.equal(readiness(blankForm({ choice: "apprentice" }), BUILT_IN).reasonCodes[0].kind, "default");
});

test("before the archetypes fetch lands (empty prop) readiness reads the built-in registry", () => {
  assert.deepEqual(readiness(blankForm({ choice: "student" }), []), readiness(blankForm({ choice: "student" }), BUILT_IN));
});

test("pyRound2 is Python's round(x, 2): exact binary ties go to even", () => {
  assert.equal(pyRound2(0.125), 0.12);
  assert.equal(pyRound2(0.375), 0.38);
  assert.equal(pyRound2(2 / 3.5), 0.57);
  assert.equal(pyRound2(3.5 / 4.5), 0.78);
  assert.equal(pyRound2(1), 1);
});

test("the live signals are the ones the save sends (useProfileEditorSubmit's request body)", () => {
  const src = readText("app/features/tools/profile/useProfileEditorSubmit.ts");
  const body = /const signals = \{\n([\s\S]*?)\n\s*\};/.exec(src)?.[1];
  assert.ok(body, "useProfileEditorSubmit must still build a `signals` object");
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(lines, [
    "selfDeclared: fields.choice,",
    "isEnrolled: fields.isEnrolled,",
    "expectedGraduation: fields.expectedGraduation || undefined,",
    "wantsDomainChange: fields.wantsDomainChange,",
    "hasSubstantialExperience: fields.hasSubstantialExperience,",
  ], "the save's signals changed shape - mirror the change in readinessSignals");
  const form = blankForm({ choice: "bau", isEnrolled: true, wantsDomainChange: true });
  assert.deepEqual(readinessSignals(form), {
    selfDeclared: "bau",
    isEnrolled: true,
    expectedGraduation: undefined,
    wantsDomainChange: true,
    hasSubstantialExperience: false,
  });
});
