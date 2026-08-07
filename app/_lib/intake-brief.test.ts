// The RoleBrief → JD-build projection (promote step). Pure module, no DB.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { briefIntentSummary, briefMustSkills, briefNiceSkills, briefReadyToPromote, needTextFromBrief } from "./intake-brief.ts";
import type { RoleBrief } from "./rolespec.ts";

const brief: RoleBrief = {
  title: "Data Analyst",
  seniority: "senior",
  roleFamily: "data_analytics",
  summary: "Reporting keeps slipping; nobody owns the dashboards.",
  successCriteria: ["Weekly reporting runs without manual work"],
  responsibilities: ["Own the dashboard stack"],
  requirements: [
    { skill: "SQL", kind: "must_have", hardness: "prerequisite", weight: 0.8, rationale: "", provenance: "stated", confidence: 0.9 },
    { skill: "dbt", kind: "nice_to_have", hardness: "learnable", weight: 0.4, rationale: "", provenance: "stated", confidence: 0.9 },
  ],
  facets: [
    { key: "urgency", label: "Urgency", value: "Ops team is losing trust", importance: "core", provenance: "stated", confidence: 0.9 },
  ],
};

test("needTextFromBrief flattens narrative → outcomes → graded requirements → facets", () => {
  const text = needTextFromBrief(brief);
  const lines = text.split("\n");
  assert.equal(lines[0], "Reporting keeps slipping; nobody owns the dashboards.");
  assert.ok(text.includes("Done in 90 days: Weekly reporting runs without manual work"));
  assert.ok(text.includes("Must have: SQL"));
  assert.ok(text.includes("Nice to have: dbt"));
  assert.ok(text.includes("Urgency: Ops team is losing trust"));
  // Outcomes come before requirements (the de-spec framing survives the flatten).
  assert.ok(text.indexOf("Done in 90 days") < text.indexOf("Must have: SQL"));
});

test("skill projections split by kind", () => {
  assert.deepEqual(briefMustSkills(brief), ["SQL"]);
  assert.deepEqual(briefNiceSkills(brief), ["dbt"]);
});

test("readiness needs a title plus substance; empty briefs refuse", () => {
  assert.equal(briefReadyToPromote(brief), true);
  assert.equal(briefReadyToPromote(null), false);
  assert.equal(briefReadyToPromote({ title: "X" }), false);
  assert.equal(briefReadyToPromote({ title: "X", successCriteria: ["ships"] }), true);
  assert.equal(briefReadyToPromote({ successCriteria: ["ships"] }), false);
});

test("briefIntentSummary digests outcomes + dealbreakers, never fires on empty briefs", () => {
  const intent = briefIntentSummary(brief);
  assert.ok(intent);
  assert.ok(intent.includes("success in the first 90 days means: Weekly reporting runs without manual work"));
  assert.ok(intent.includes("dealbreakers are: SQL"));
  assert.ok(intent.includes("urgency: Ops team is losing trust"));
  assert.ok(intent.includes("never read this note aloud"));
  assert.equal(briefIntentSummary(null), null);
  assert.equal(briefIntentSummary({ title: "X" }), null);
});
