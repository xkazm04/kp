// The role coach's ledger — pins the derivation and the projection arithmetic the
// three variants share. The invariants that matter:
//   - a pattern that costs nobody is not a row (the ledger is findings, not inventory),
//   - a missing skill is measured against the ELIGIBLE pool, a gate against the whole
//     pool, and each row carries its own denominator so neither can be misquoted,
//   - the salary row appears only for a BELOW-MARKET band and carries NO share (a
//     zero there would read as "this costs nobody"),
//   - the projection claims a pattern's gain in proportion to its weight, claims
//     nothing for an untagged one, and never projects past the pool.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  derivePatterns,
  laneWeight,
  patternsInLane,
  projectPool,
  PRIORITY_WEIGHT,
  RELAXATION,
  type RolePriorityMap,
  type Winnability,
} from "./rolePatterns.ts";

const WIN: Winnability = {
  poolSize: 34,
  eligible: 20,
  qualified: 6,
  looseGates: [
    { kind: "language", value: "Czech C1", eligibleDelta: 8 },
    { kind: "education", value: "bachelor", eligibleDelta: 0 },
  ],
  looseMustHaves: [
    { skill: "Kubernetes", missingAmongEligible: 14, qualifiedDelta: 3 },
    { skill: "Terraform", missingAmongEligible: 0, qualifiedDelta: 2 },
    { skill: "COBOL", missingAmongEligible: 0, qualifiedDelta: 0 },
  ],
  salary: { family: "platform", seniority: "senior", jobBand: [60000, 80000], marketBand: [75000, 95000], belowMarket: true },
};

test("derivePatterns drops every finding that costs nobody", () => {
  const ids = derivePatterns(WIN).map((p) => p.id);
  // The zero-delta education gate and the all-zero COBOL must-have are not findings.
  assert.deepEqual(ids, ["skill:Kubernetes", "language:Czech C1", "skill:Terraform", "salary:band"]);
});

test("each row carries the denominator its share was measured against", () => {
  const byId = new Map(derivePatterns(WIN).map((p) => [p.id, p]));
  const gate = byId.get("language:Czech C1")!;
  assert.equal(gate.denominator, 34);
  assert.equal(gate.share, 8 / 34);
  const skill = byId.get("skill:Kubernetes")!;
  // Measured among the 20 who clear the gates, NOT the 34 in the pool — quoting the
  // wider denominator would understate a 70% gap as 41%.
  assert.equal(skill.denominator, 20);
  assert.equal(skill.share, 14 / 20);
});

test("a must-have with no missing candidates but a real demotion gain still earns a row", () => {
  const terraform = derivePatterns(WIN).find((p) => p.id === "skill:Terraform")!;
  assert.equal(terraform.affected, 0);
  assert.equal(terraform.gain, 2);
});

test("the salary row appears only below market, carries no share, and is not editable", () => {
  const salary = derivePatterns(WIN).find((p) => p.kind === "salary")!;
  assert.equal(salary.share, null);
  assert.equal(salary.editable, false);
  // Silenced verdict (cross-currency, no FX) and an in-line band are both "no row".
  const silenced = { ...WIN, salary: { ...WIN.salary!, belowMarket: null } };
  assert.equal(derivePatterns(silenced).some((p) => p.kind === "salary"), false);
  const inLine = { ...WIN, salary: { ...WIN.salary!, belowMarket: false } };
  assert.equal(derivePatterns(inLine).some((p) => p.kind === "salary"), false);
});

test("an empty or absent grade derives nothing", () => {
  assert.deepEqual(derivePatterns(null), []);
  assert.deepEqual(derivePatterns({ poolSize: 0 }), []);
});

test("the projection claims a gain in proportion to the weight the recruiter set", () => {
  const patterns = derivePatterns(WIN);
  // Kubernetes gain 3, Czech gain 8, Terraform gain 2.
  const priorities: RolePriorityMap = { "skill:Kubernetes": "minor", "language:Czech C1": "important" };
  const p = projectPool(patterns, priorities, 6, 34);
  // 6 + (3 * 1) + (8 * 0.5) = 13; Terraform is untagged and claims nothing.
  assert.equal(p.projected, 13);
  assert.equal(p.contributing, 2);
  assert.equal(p.base, 6);
});

test("an untagged or critical pattern claims nothing — 'not yet judged' is not 'drop it'", () => {
  const patterns = derivePatterns(WIN);
  assert.equal(projectPool(patterns, {}, 6, 34).projected, 6);
  assert.equal(projectPool(patterns, {}, 6, 34).contributing, 0);
  const held: RolePriorityMap = { "skill:Kubernetes": "critical", "language:Czech C1": "critical" };
  assert.equal(projectPool(patterns, held, 6, 34).projected, 6);
  assert.equal(RELAXATION.critical, 0);
});

test("the projection never runs past the pool it is projecting into", () => {
  const patterns = derivePatterns(WIN);
  const all: RolePriorityMap = { "skill:Kubernetes": "minor", "language:Czech C1": "minor", "skill:Terraform": "minor" };
  // 6 + 3 + 8 + 2 = 19 under a cap of 34, but only 10 under a cap of 10.
  assert.equal(projectPool(patterns, all, 6, 34).projected, 19);
  assert.equal(projectPool(patterns, all, 6, 10).projected, 10);
  // A base already above the cap is never dragged DOWN by the projection.
  assert.equal(projectPool(patterns, all, 12, 10).projected, 12);
});

test("lanes partition the ledger and their weights sum the level's worth", () => {
  const patterns = derivePatterns(WIN);
  const priorities: RolePriorityMap = { "skill:Kubernetes": "critical", "language:Czech C1": "critical", "salary:band": "minor" };
  assert.deepEqual(patternsInLane(patterns, priorities, "critical").map((p) => p.id), ["skill:Kubernetes", "language:Czech C1"]);
  assert.deepEqual(patternsInLane(patterns, priorities, "important").map((p) => p.id), []);
  // The inbox strip: everything nobody has weighed yet.
  assert.deepEqual(patternsInLane(patterns, priorities, null).map((p) => p.id), ["skill:Terraform"]);
  assert.equal(laneWeight(patterns, priorities, "critical"), 2 * PRIORITY_WEIGHT.critical);
  assert.equal(laneWeight(patterns, priorities, "minor"), PRIORITY_WEIGHT.minor);
  assert.equal(laneWeight(patterns, priorities, "important"), 0);
});
