// ADR-0009 — the frozen role rubric and the ONE evaluation both populations are
// judged by. Pure module: no DB, so these run as plain unit tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EmptyRubricError,
  evaluateAgainstRubric,
  freezeRubric,
  hashCriteria,
  rubricWouldChange,
  skillKey,
} from "./role-rubric.ts";
import type { RoleBrief } from "./rolespec.ts";

function brief(requirements: RoleBrief["requirements"]): RoleBrief {
  return {
    title: "Data Analyst",
    seniority: "senior",
    roleFamily: "data_analytics",
    summary: "Reporting keeps slipping; nobody owns the dashboards.",
    successCriteria: ["Weekly reporting runs without manual work"],
    responsibilities: ["Own the dashboard stack"],
    requirements,
    facets: [],
  };
}

const req = (skill: string, kind: string, hardness: string, weight: number) => ({
  skill,
  kind,
  hardness,
  weight,
  rationale: "",
  provenance: "stated",
  confidence: 0.9,
});

const BASE = brief([
  req("SQL", "must_have", "prerequisite", 0.8),
  req("dbt", "nice_to_have", "learnable", 0.4),
]);

test("freezeRubric carries the brief's OWN graded requirements, unchanged", () => {
  const rubric = freezeRubric(BASE);
  assert.equal(rubric.version, 1);
  assert.deepEqual(
    rubric.criteria.map((c) => [c.skill, c.kind, c.hardness, c.weight]),
    [
      ["dbt", "nice_to_have", "learnable", 0.4],
      ["SQL", "must_have", "prerequisite", 0.8],
    ],
    "criteria are content-ordered, with kind/hardness/weight preserved verbatim"
  );
});

test("the hash is a function of content, not of the order the requestor spoke in", () => {
  const reordered = brief([req("dbt", "nice_to_have", "learnable", 0.4), req("SQL", "must_have", "prerequisite", 0.8)]);
  assert.equal(freezeRubric(BASE).criteriaHash, freezeRubric(reordered).criteriaHash);
  // POSITIVE CONTROL — the hash must actually be sensitive to a real change,
  // otherwise the equality above is satisfied by a constant.
  const weightened = brief([req("SQL", "must_have", "prerequisite", 0.9), req("dbt", "nice_to_have", "learnable", 0.4)]);
  assert.notEqual(freezeRubric(BASE).criteriaHash, freezeRubric(weightened).criteriaHash);
  // And to a kind change, which is the one that decides whether a gap BLOCKS.
  const demoted = brief([req("SQL", "nice_to_have", "prerequisite", 0.8), req("dbt", "nice_to_have", "learnable", 0.4)]);
  assert.notEqual(freezeRubric(BASE).criteriaHash, freezeRubric(demoted).criteriaHash);
});

test("rubricWouldChange is true only when candidates would be judged differently", () => {
  const current = freezeRubric(BASE);
  const proseOnly = { ...BASE, summary: "Completely different narrative, same requirements." };
  assert.equal(rubricWouldChange(current, proseOnly), false, "a prose edit must not force a re-score");
  const realEdit = brief([
    req("SQL", "must_have", "prerequisite", 0.8),
    req("dbt", "nice_to_have", "learnable", 0.4),
    req("Airflow", "must_have", "prerequisite", 0.6),
  ]);
  assert.equal(rubricWouldChange(current, realEdit), true, "a new must_have changes what candidates are judged by");
});

test("a brief that states no graded requirements cannot be frozen", () => {
  assert.throws(() => freezeRubric(brief([])), EmptyRubricError);
});

test("skill matching is casing-insensitive across the three evidence producers", () => {
  assert.equal(skillKey("  SQL "), skillKey("sql"));
  const rubric = freezeRubric(BASE);
  const ev = evaluateAgainstRubric(rubric, { covered: ["sql"], source: "cv" });
  assert.equal(ev.mustCoverage, 1, "'sql' from the matcher must satisfy the brief's 'SQL'");
});

test("a person and an AI agent with the same coverage get the SAME evaluation", () => {
  const rubric = freezeRubric(BASE);
  const human = evaluateAgainstRubric(rubric, { covered: ["SQL", "dbt"], source: "cv" });
  const agent = evaluateAgainstRubric(rubric, { covered: ["SQL", "dbt"], source: "agent_fit" });
  // Everything except the declared provenance is identical — that identity IS
  // "the same evaluation" half of hire-from-need.
  assert.deepEqual({ ...human, source: null }, { ...agent, source: null });
  assert.equal(human.source, "cv");
  assert.equal(agent.source, "agent_fit");
  assert.equal(human.mustCoverage, 1);
  assert.equal(human.niceCoverage, 1);
  assert.deepEqual(human.unmetMust, []);
});

test("must and nice coverage are reported separately, never fused into one score", () => {
  const rubric = freezeRubric(BASE);
  const ev = evaluateAgainstRubric(rubric, { covered: ["dbt"], source: "cv" });
  assert.equal(ev.mustCoverage, 0, "the must_have is unmet");
  assert.equal(ev.niceCoverage, 1, "the nice_to_have is met");
  assert.deepEqual(ev.unmetMust, ["SQL"], "the gap is NAMED, not silently deducted");
  // The evaluation must not expose a single fused 0-100: fabricating that
  // comparability is exactly what ADR-0008 forbids sealing into a decision.
  assert.equal(
    Object.keys(ev).some((k) => /^(score|overall|total|rating)$/i.test(k)),
    false,
    "no single fused score field may appear on a rubric evaluation"
  );
});

test("coverage is WEIGHTED, so meeting the heavy must is not the same as meeting the light one", () => {
  const twoMusts = brief([
    req("SQL", "must_have", "prerequisite", 0.8),
    req("Airflow", "must_have", "prerequisite", 0.2),
  ]);
  const rubric = freezeRubric(twoMusts);
  const heavy = evaluateAgainstRubric(rubric, { covered: ["SQL"], source: "cv" });
  const light = evaluateAgainstRubric(rubric, { covered: ["Airflow"], source: "cv" });
  assert.equal(heavy.mustCoverage, 0.8);
  assert.equal(light.mustCoverage, 0.2);
});

test("an unassessed candidate is not a zero-scoring candidate", () => {
  const rubric = freezeRubric(BASE);
  // The unassessed path ignores any covered list it is handed — a producer that
  // reports "unassessed" has made no judgement, and the board must not read one.
  const ev = evaluateAgainstRubric(rubric, { covered: ["SQL", "dbt"], source: "unassessed" });
  assert.equal(ev.source, "unassessed");
  assert.equal(ev.perCriterion.every((c) => !c.met), true);
  assert.deepEqual(ev.unmetMust, ["SQL"]);
});

test("a rubric stating no must_haves reports 0 must coverage, never 1", () => {
  const niceOnly = brief([req("dbt", "nice_to_have", "learnable", 0.4)]);
  const ev = evaluateAgainstRubric(freezeRubric(niceOnly), { covered: ["dbt"], source: "cv" });
  assert.equal(ev.mustCoverage, 0, "'nothing required' must not read as 'everything met'");
  assert.equal(ev.niceCoverage, 1);
  assert.deepEqual(ev.unmetMust, []);
});

test("hashCriteria is stable across calls (the store compares it on every read)", () => {
  const criteria = freezeRubric(BASE).criteria;
  assert.equal(hashCriteria(criteria), hashCriteria([...criteria].reverse()));
});
