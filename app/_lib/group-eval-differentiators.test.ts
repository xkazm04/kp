// Pins the group-eval differentiator contract (idea-810a45bc): a differentiator
// is the lead's *role-relevant* edge — a requirement skill the lead MATCHED that
// every rival MISSED — never a top self-declared skill claim that the job never
// asked for. Guards the regression where off-topic claims were highlighted while
// the lead's real edge stayed hidden.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { computeDifferentiators, type Requirement } from "./group-eval-differentiators.ts";

const reqs: Requirement[] = [
  { skill: "TypeScript", kind: "must_have" },
  { skill: "React", kind: "must_have" },
  { skill: "GraphQL", kind: "nice_to_have" },
  { skill: "Kubernetes", kind: "nice_to_have" },
];

test("returns requirement skills the lead matched that no rival matched", () => {
  const lead = { matchedSkills: ["TypeScript", "React", "GraphQL"] };
  const rivals = [{ matchedSkills: ["TypeScript"] }, { matchedSkills: ["React"] }];
  // TypeScript + React are matched by a rival; only GraphQL is the lead's exclusive edge.
  assert.deepEqual(computeDifferentiators(lead, rivals, reqs), ["GraphQL"]);
});

test("ignores a lead match that is NOT a role requirement (the core fix)", () => {
  // "Photoshop" is a self-declared skill the lead has but the role never asked for —
  // it must never surface as a differentiator even though no rival has it.
  const lead = { matchedSkills: ["Photoshop", "GraphQL"] };
  const rivals = [{ matchedSkills: ["TypeScript"] }];
  assert.deepEqual(computeDifferentiators(lead, rivals, reqs), ["GraphQL"]);
});

test("a requirement every rival also matched is not a differentiator", () => {
  const lead = { matchedSkills: ["TypeScript", "React"] };
  const rivals = [{ matchedSkills: ["TypeScript", "React"] }];
  assert.deepEqual(computeDifferentiators(lead, rivals, reqs), []);
});

test("orders must-have differentiators ahead of nice-to-haves", () => {
  // Lead carries one nice-to-have (GraphQL) and one must-have (React) edge; the
  // must-have is the stronger reason to pick the lead, so it leads the list.
  const lead = { matchedSkills: ["GraphQL", "React"] };
  const rivals = [{ matchedSkills: ["TypeScript"] }];
  assert.deepEqual(computeDifferentiators(lead, rivals, reqs), ["React", "GraphQL"]);
});

test("caps the list and keeps must-haves over the cap boundary", () => {
  const wideReqs: Requirement[] = [
    { skill: "n1", kind: "nice_to_have" },
    { skill: "n2", kind: "nice_to_have" },
    { skill: "n3", kind: "nice_to_have" },
    { skill: "n4", kind: "nice_to_have" },
    { skill: "n5", kind: "nice_to_have" },
    { skill: "m1", kind: "must_have" },
  ];
  // Six exclusive edges, five of them nice-to-have listed first; the lone must-have
  // (m1) must survive the cap of 5 by being ordered first. One present rival that
  // matches none of them satisfies the min-cohort floor (#4) while keeping all six
  // edges exclusive to the lead, so the cap/ordering is what's under test.
  const lead = { matchedSkills: ["n1", "n2", "n3", "n4", "n5", "m1"] };
  const result = computeDifferentiators(lead, [{ matchedSkills: [] }], wideReqs, 5);
  assert.equal(result.length, 5);
  assert.equal(result[0], "m1");
  assert.ok(!result.includes("n5"));
});

test("no lead (empty field) yields no differentiators", () => {
  assert.deepEqual(computeDifferentiators(null, [], reqs), []);
});

test("a job-less role (no requirements) has no role-relevant edge", () => {
  // Without declared requirements there is nothing to anchor relevance to, so the
  // honest result is empty rather than a list of off-topic self-declared skills.
  const lead = { matchedSkills: ["TypeScript", "React"] };
  assert.deepEqual(computeDifferentiators(lead, [{ matchedSkills: [] }], []), []);
});

test("tolerates missing/null matchedSkills on lead and rivals", () => {
  assert.deepEqual(computeDifferentiators({}, [{}], reqs), []);
  assert.deepEqual(
    computeDifferentiators({ matchedSkills: null }, [{ matchedSkills: null }], reqs),
    []
  );
});

// ---- The unmeasured-rival floor (scan-sweep) -------------------------------
//
// group-eval-run leaves `matchedSkills` undefined for every candidate the recruiter
// pool could not resolve — an entry with no candidateId, one whose profile AND analysis
// are gone, or a row recruiter_cli skipped as malformed. Those candidates are still
// COMPARED (and still ranked on their stored matchScore). Treating their absent skills
// as "matched nothing" made every requirement skill the lead matched and the one SCORED
// rival missed read as an exclusive edge — printed as the reason to pick the lead and
// sealed verbatim into the decision rationale ("Unique strengths: …").
//
// NON-VACUITY: pre-fix the first assertion below returned ["GraphQL"] (the unscored
// rival's absent list contributed nothing to `rivalMatched`), not []. The second pins
// that a SCORED rival who genuinely matched nothing still counts as a miss, so the
// ordinary edge survives.
test("an UNMEASURED rival blocks the exclusivity claim — unknown is not a miss", () => {
  const lead = { matchedSkills: ["GraphQL"] };
  // `{}` = never scored (no recruiter row), NOT "scored and matched nothing".
  assert.deepEqual(computeDifferentiators(lead, [{}], reqs), []);
  assert.deepEqual(computeDifferentiators(lead, [{ matchedSkills: null }], reqs), []);
  // One unmeasured rival taints the whole field: the claim is "no rival matched it".
  assert.deepEqual(computeDifferentiators(lead, [{ matchedSkills: ["React"] }, {}], reqs), []);
});

test("a SCORED rival that matched nothing is a genuine miss — the edge stands", () => {
  const lead = { matchedSkills: ["GraphQL"] };
  assert.deepEqual(computeDifferentiators(lead, [{ matchedSkills: [] }], reqs), ["GraphQL"]);
});

test("de-duplicates a skill the lead lists twice", () => {
  // One present-but-non-matching rival satisfies the min-cohort floor (#4) while
  // leaving GraphQL exclusive to the lead, so dedup is what's under test.
  const lead = { matchedSkills: ["GraphQL", "GraphQL"] };
  assert.deepEqual(computeDifferentiators(lead, [{ matchedSkills: [] }], reqs), ["GraphQL"]);
});
