import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveRoleRubric, evaluateAgainstRubric } from "./role-rubric.ts";
import { agentEvidence, humanEvidence, AGENT_COVERAGE_SCORE } from "./slate-evidence.ts";
import type { RoleBrief } from "./rolespec.ts";

const brief = {
  requirements: [
    { skill: "SQL", kind: "must_have", hardness: "prerequisite", weight: 0.9 },
    { skill: "Data  Modeling", kind: "must_have", hardness: "prerequisite", weight: 0.8 },
    { skill: "dbt", kind: "nice_to_have", hardness: "learnable", weight: 0.5 },
    { skill: "Airflow", kind: "nice_to_have", hardness: "learnable", weight: 0.4 },
  ],
  facets: [
    { key: "budget_band", label: "Budget", value: "up to 5k", importance: "core" },
    { key: "team_culture", label: "Culture", value: "async", importance: "core" },
  ],
} as unknown as RoleBrief;

const axes = Object.freeze(deriveRoleRubric(brief).map((a) => Object.freeze(a)));
const rubric = { version: 1, axes };

const human = (matching: string[], missing: string[]) => humanEvidence(axes, { jobFit: { matchingSkills: matching, missingSkills: missing } }, "analysis-1");
const agent = (coverage: { item: string; coverage: string; rationale?: string }[]) => agentEvidence(axes, { coverage }, "fit-1");

test("a person and an agent with equivalent coverage are judged identically", () => {
  const h = evaluateAgainstRubric(rubric, human(["sql", "data modeling"], ["airflow"]));
  const a = evaluateAgainstRubric(
    rubric,
    agent([
      { item: "SQL", coverage: "automatable" },
      { item: "Data modeling", coverage: "automatable" },
      { item: "Airflow", coverage: "human_only" },
    ])
  );
  assert.equal(h.blockingCoverage, a.blockingCoverage);
  assert.equal(h.otherCoverage, a.otherCoverage);
  assert.deepEqual(h.unmetBlocking, a.unmetBlocking);
  assert.deepEqual(h.unassessed, a.unassessed);
  assert.equal(h.population, "human");
  assert.equal(a.population, "agent");
  assert.equal(h.basis.find((b) => b.axis === "req:sql")!.source, "analysis");
  assert.equal(a.basis.find((b) => b.axis === "req:sql")!.source, "agent_fit");
  assert.equal(h.basis.find((b) => b.axis === "req:sql")!.evidenceRef, "analysis-1");
  assert.equal(a.basis.find((b) => b.axis === "req:sql")!.evidenceRef, "fit-1");
});

test("an axis nothing names is unassessed, never scored 0", () => {
  const h = human(["sql"], []);
  assert.equal("req:dbt" in h.axes, false);
  const ev = evaluateAgainstRubric(rubric, h);
  assert.ok(ev.unassessed.includes("req:dbt"));
  assert.ok(ev.unmetBlocking.includes("req:data modeling"));
  assert.equal(ev.basis.find((b) => b.axis === "req:dbt")!.score, null);
  // a named-missing skill IS a real 0
  assert.equal(human([], ["dbt"]).axes["req:dbt"].score, 0);
});

test("facet and cost axes are never filled", () => {
  const nonReq = axes.filter((a) => a.evidenceClass !== "requirement_coverage");
  assert.ok(nonReq.length >= 2);
  const h = human(["sql"], []);
  const a = agent([{ item: "SQL", coverage: "automatable" }]);
  for (const ax of nonReq) {
    assert.equal(ax.key in h.axes, false);
    assert.equal(ax.key in a.axes, false);
  }
  // even when an item is named like a facet key
  const sneaky = agent([{ item: "budget_band", coverage: "automatable" }, { item: "cost:budget_band", coverage: "automatable" }]);
  assert.deepEqual(sneaky.axes, {});
});

test("case and whitespace variants match; an unknown coverage word does not", () => {
  assert.equal(human(["  data   MODELING "], []).axes["req:data modeling"].score, 1);
  assert.equal(agent([{ item: " DATA\tmodeling", coverage: "assisted" }]).axes["req:data modeling"].score, 0.5);
  assert.deepEqual(agent([{ item: "SQL", coverage: "mostly" }]).axes, {});
  assert.deepEqual(agent([{ item: "SQL", coverage: "AUTOMATABLE" }]).axes, {});
});

test("a malformed agent fit yields no axes", () => {
  for (const fit of [null, undefined, 3, "x", {}, { coverage: "no" }, { coverage: [null, 4, { item: 1, coverage: "automatable" }, { item: "SQL" }] }]) {
    assert.deepEqual(agentEvidence(axes, fit, "fit-1").axes, {});
  }
  assert.deepEqual(humanEvidence(axes, null, "a").axes, {});
  assert.deepEqual(humanEvidence(axes, { jobFit: null }, "a").axes, {});
});

test("the agent scale is agentfit.py's three numbers", () => {
  assert.deepEqual({ ...AGENT_COVERAGE_SCORE }, { automatable: 1, assisted: 0.5, human_only: 0 });
});
