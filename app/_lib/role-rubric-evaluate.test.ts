// ADR-0012 §3 — one evaluation over the frozen RubricAxis[], two evidence adapters.
// Pure: no DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RubricAxis } from "./schemas.generated.ts";
import { evaluateAgainstRubric, evidenceSourceFor, sameRubricAxes } from "./role-rubric.ts";

const axis = (key: string, over: Partial<RubricAxis> = {}): RubricAxis => ({
  key,
  label: key,
  origin: "requirement",
  kind: "must_have",
  hardness: "prerequisite",
  weight: 0.5,
  blocking: true,
  provenance: "stated",
  evidenceClass: "requirement_coverage",
  humanEvidence: "analysis",
  agentEvidence: "agent_fit",
  rationale: "",
  ...over,
});

const RUBRIC = {
  version: 3,
  axes: [
    axis("req:sql", { weight: 0.6 }),
    axis("req:dbt", { weight: 0.2, kind: "nice_to_have", hardness: "learnable", blocking: false }),
    axis("facet:work_environment", {
      weight: 0.2,
      origin: "facet",
      kind: "core",
      hardness: "",
      blocking: false,
      evidenceClass: "demonstrated_work",
      humanEvidence: "devcase",
      agentEvidence: "trial_run",
    }),
  ],
};

test("the adapter is a lookup on the axis: same axis, population picks the producer", () => {
  const a = RUBRIC.axes[2];
  assert.equal(evidenceSourceFor(a, "human"), "devcase");
  assert.equal(evidenceSourceFor(a, "agent"), "trial_run");
});

test("person and agent with identical evidence get identical scores; only the basis source differs", () => {
  const axes = { "req:sql": { score: 1, evidenceRef: "ref-1" }, "req:dbt": { score: 0.5 } };
  const h = evaluateAgainstRubric(RUBRIC, { population: "human", axes });
  const a = evaluateAgainstRubric(RUBRIC, { population: "agent", axes });
  assert.equal(h.blockingCoverage, a.blockingCoverage);
  assert.equal(h.otherCoverage, a.otherCoverage);
  assert.equal(h.rubricVersion, 3);
  assert.deepEqual(h.basis.map((b) => b.source), ["analysis", "analysis", "devcase"]);
  assert.deepEqual(a.basis.map((b) => b.source), ["agent_fit", "agent_fit", "trial_run"]);
  assert.equal(h.basis[0].evidenceRef, "ref-1");
});

test("no fused score: blocking and other coverage are separate, unmet blocking is named", () => {
  const e = evaluateAgainstRubric(RUBRIC, { population: "human", axes: { "req:dbt": { score: 1 } } });
  assert.equal(e.blockingCoverage, 0);
  assert.equal(e.otherCoverage, 1, "only the assessed non-blocking axis counts");
  assert.deepEqual(e.unmetBlocking, ["req:sql"]);
  assert.deepEqual(e.unassessed, ["req:sql", "facet:work_environment"]);
  for (const k of Object.keys(e)) assert.ok(!/^(score|total|overall)$/i.test(k), `no fused field: ${k}`);
});

test("unassessed is not zero: no evidence leaves otherCoverage null, scores are clamped", () => {
  const e = evaluateAgainstRubric(RUBRIC, { population: "agent", axes: { "req:sql": { score: 7 } } });
  assert.equal(e.otherCoverage, null);
  assert.equal(e.blockingCoverage, 1);
  assert.deepEqual(e.unmetBlocking, []);
});

test("sameRubricAxes tells a prose edit from a standard change", () => {
  assert.equal(sameRubricAxes(RUBRIC.axes, structuredClone(RUBRIC.axes)), true);
  assert.equal(sameRubricAxes(RUBRIC.axes, [...RUBRIC.axes.slice(0, 2)]), false);
});
