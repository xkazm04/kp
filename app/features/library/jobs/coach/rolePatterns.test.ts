// The role coach's ledger — pins the derivation the ledger reads. The invariants
// that matter:
//   - a pattern that costs nobody is not a row (the ledger is findings, not inventory),
//   - a missing skill is measured against the ELIGIBLE pool, a gate against the whole
//     pool, and each row carries its own denominator so neither can be misquoted,
//   - the salary row appears only for a BELOW-MARKET band and carries NO share (a
//     zero there would read as "this costs nobody"),
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  derivePatterns,
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
