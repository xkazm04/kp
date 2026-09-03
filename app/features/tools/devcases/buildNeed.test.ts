// buildNeed is the Define tab's whole contribution to everything downstream — the
// analyze run, the role design, the case design and the seed all read the object it
// returns. It was untested because it lived inside useDevTabData(), a React hook, and
// this repo has no jsdom (node:test + type stripping). Extracted, it is a pure fold
// and these are the four claims it makes.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CODEBASES } from "@/app/_lib/devcase-constraints";
import { buildNeed, MAX_RESPONSIBILITIES, MAX_STACK } from "./buildNeed.ts";
import type { SelectedJd } from "./DevTypes.ts";

const jd = (brief?: SelectedJd["brief"]): SelectedJd => ({
  slug: "backend-eng",
  title: "  Backend Engineer  ",
  body: "We need someone to own the billing service.",
  brief,
});

test("a JD with no intake behind it: the prose anchor, nothing invented", () => {
  const need = buildNeed({ jd: jd(null), repoUrls: ["  https://github.com/acme/api  ", "", "  "], seniority: "senior" });
  assert.equal(need.title, "Backend Engineer", "the title is trimmed — it is rendered verbatim downstream");
  assert.deepEqual(need.stack, [], "nothing graded this need, so it states no stack");
  assert.deepEqual(need.responsibilities, []);
  assert.deepEqual(need.codebaseRefs, [{ kind: "github", ref: "https://github.com/acme/api" }]);
  assert.equal(need.seniorityTarget, "senior");
  assert.equal(need.roleFamily, "software_engineering", "the recorded default for an unclassified need");
  assert.equal(need.jdSlug, "backend-eng");
  assert.equal(need.jdText, "We need someone to own the billing service.");
  // The KEY must be ABSENT, not an empty array: `statedRequirements: []` tells the
  // role designer "this need grades nothing", which is a different claim from
  // "nothing has graded it yet".
  assert.ok(!("statedRequirements" in need), "an ungraded need carries no statedRequirements key");
});

test("must_haves become the stack; nice_to_haves do not", () => {
  const need = buildNeed({
    jd: jd({
      requirements: [
        { skill: "Go", kind: "must_have" },
        { skill: "Kafka", kind: "nice_to_have" },
        { skill: "Postgres", kind: "must_have" },
      ],
    } as SelectedJd["brief"]),
    repoUrls: [""],
    seniority: "medior",
  });
  // NON-VACUITY: an unfiltered fold would put Kafka second.
  assert.deepEqual(need.stack, ["Go", "Postgres"]);
  // …but every GRADED requirement rides along for role design, must-have or not:
  // the designer needs to know what is optional as well as what is required.
  assert.deepEqual(
    need.statedRequirements?.map((r) => `${r.skill}:${r.kind}`),
    ["Go:must_have", "Kafka:nice_to_have", "Postgres:must_have"],
  );
});

test("successCriteria lead the responsibilities, and empties are dropped", () => {
  const need = buildNeed({
    jd: jd({
      successCriteria: ["Ship the migration", ""],
      responsibilities: ["Own billing", "", "On-call"],
    } as SelectedJd["brief"]),
    repoUrls: [""],
    seniority: "medior",
  });
  // ORDER is the claim: the 90-day outcomes are what the case is designed against, so
  // they must survive the cap ahead of the standing duties.
  assert.deepEqual(need.responsibilities, ["Ship the migration", "Own billing", "On-call"]);
});

test("every list is capped, and the codebase cap is the shared constraint", () => {
  const many = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p}${i}`);
  const need = buildNeed({
    jd: jd({
      requirements: many(20, "skill").map((skill) => ({ skill, kind: "must_have" })),
      successCriteria: many(10, "outcome"),
      responsibilities: many(10, "duty"),
    } as SelectedJd["brief"]),
    repoUrls: many(MAX_CODEBASES + 3, "https://github.com/acme/r"),
    seniority: "junior",
  });
  assert.equal(need.stack.length, MAX_STACK);
  assert.equal(need.responsibilities.length, MAX_RESPONSIBILITIES);
  // The codebase cap is MAX_CODEBASES from devcase-constraints.ts — the SAME constant
  // the form's "add repo" button and the server-side validator use, so the three can
  // never disagree about how many repos a need may carry.
  assert.equal(need.codebaseRefs.length, MAX_CODEBASES);
  // statedRequirements is deliberately NOT capped at MAX_STACK: the stack is the
  // headline the designer builds from, the graded list is the full evidence.
  assert.equal(need.statedRequirements?.length, 20);
});

test("no JD selected yields an empty-but-well-formed need (never undefined fields)", () => {
  const need = buildNeed({ jd: null, repoUrls: [""], seniority: "medior" });
  assert.deepEqual(need, {
    title: "",
    stack: [],
    responsibilities: [],
    codebaseRefs: [],
    seniorityTarget: "medior",
    roleFamily: "software_engineering",
    jdSlug: "",
    jdText: "",
  });
});
