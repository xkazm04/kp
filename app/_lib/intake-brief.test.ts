// The RoleBrief → JD-build projection (promote step). Pure module, no DB.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  briefDealbreakerEvidence,
  briefIntentSummary,
  briefMustSkills,
  briefNiceSkills,
  briefOutcomeEvidence,
  briefPromoteBlockers,
  briefReadyToPromote,
  briefStatedRequirements,
  needTextFromBrief,
} from "./intake-brief.ts";
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

// UAT L2-NEW-2 — the live shape that blocked promote: a rich session whose hard
// conditions and 90-day outcome live in FACETS because the extraction filed them
// there (requirements[] and successCriteria[] both empty).
const facetOnlyBrief: RoleBrief = {
  title: "Band 5 Registered Nurse",
  facets: [
    { key: "why_now", label: "Why now", value: "Two of three nurses are leaving.", importance: "core", provenance: "stated", confidence: 1 },
    {
      key: "dealbreaker_context",
      label: "Dealbreakers",
      value: "A valid NMC registration and an enhanced DBS.",
      importance: "core",
      provenance: "stated",
      confidence: 1,
    },
  ],
};

test("readiness reads dealbreakers and outcomes in either home (UAT L2-NEW-2)", () => {
  assert.equal(briefReadyToPromote(facetOnlyBrief), true);
  assert.deepEqual(briefPromoteBlockers(facetOnlyBrief), []);
  assert.deepEqual(briefDealbreakerEvidence(facetOnlyBrief), ["A valid NMC registration and an enhanced DBS."]);
  // A facet-carried 90-day outcome counts too.
  assert.equal(
    briefReadyToPromote({
      title: "X",
      facets: [{ key: "success_90d", label: "90 days", value: "Runs her own clinic list", importance: "core", provenance: "stated", confidence: 1 }],
    }),
    true
  );
  // Unrelated context facets are NOT substance — the gate stays a gate.
  assert.deepEqual(briefPromoteBlockers({ title: "X", facets: [{ key: "why_now", label: "", value: "backfill", importance: "context", provenance: "stated", confidence: 1 }] }), [
    "substance",
  ]);
  // An empty facet value never counts.
  assert.deepEqual(
    briefPromoteBlockers({ title: "X", facets: [{ key: "dealbreaker_context", label: "", value: "  ", importance: "core", provenance: "stated", confidence: 1 }] }),
    ["substance"]
  );
});

test("briefPromoteBlockers names every missing piece (UAT L2-RC-1)", () => {
  assert.deepEqual(briefPromoteBlockers(null), ["title", "substance"]);
  assert.deepEqual(briefPromoteBlockers({}), ["title", "substance"]);
  assert.deepEqual(briefPromoteBlockers({ successCriteria: ["ships"] }), ["title"]);
  assert.deepEqual(briefPromoteBlockers({ title: "X" }), ["substance"]);
  assert.deepEqual(briefPromoteBlockers(brief), []);
  assert.deepEqual(briefOutcomeEvidence(brief), ["Weekly reporting runs without manual work"]);
});

test("briefStatedRequirements projects the graded shape the devcase chain consumes", () => {
  assert.deepEqual(briefStatedRequirements(brief), [
    { skill: "SQL", kind: "must_have", hardness: "prerequisite", weight: 0.8 },
    { skill: "dbt", kind: "nice_to_have", hardness: "learnable", weight: 0.4 },
  ]);
  assert.deepEqual(briefStatedRequirements({}), []);
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

// UAT L2-NEW-2, second half: the promote gate learned to read both homes, the
// interviewer digest had not. All five live recertify sessions stored their hard
// conditions as facet prose with requirements[] empty — so the brief richest in
// stated intent grounded the interviewer with NOTHING.
test("briefIntentSummary grounds a facet-only brief (both homes, like the promote gate)", () => {
  const intent = briefIntentSummary(facetOnlyBrief);
  assert.ok(intent, "a facet-carried dealbreaker must still ground the interviewer");
  assert.ok(intent.includes("the stated dealbreakers are: A valid NMC registration and an enhanced DBS."), intent);
  // A facet-carried 90-day outcome grounds the same way.
  const outcomeOnly = briefIntentSummary({
    title: "X",
    facets: [{ key: "success_90d", label: "90 days", value: "Runs her own clinic list", importance: "core", provenance: "stated", confidence: 1 }],
  });
  assert.ok(outcomeOnly?.includes("success in the first 90 days means: Runs her own clinic list"), String(outcomeOnly));
  // Still silent when the brief genuinely holds nothing to ground on.
  assert.equal(
    briefIntentSummary({ title: "X", facets: [{ key: "why_now", label: "", value: "backfill", importance: "context", provenance: "stated", confidence: 1 }] }),
    null
  );
  // Facet prose is capped so the digest can't swamp the agent brief.
  const long = briefIntentSummary({
    title: "X",
    facets: [{ key: "dealbreaker_context", label: "", value: "z".repeat(600), importance: "core", provenance: "stated", confidence: 1 }],
  });
  assert.ok(long && !long.includes("z".repeat(201)), "long facet prose must be trimmed");
});
