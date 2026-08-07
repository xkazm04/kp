// buildIntakeExportMarkdown — the director/inspector artifact (UAT drain §2.2).
// Pins: provenance annotations present, source-turn citations rendered,
// transcript numbered with the same indices sourceTurn cites.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIntakeExportMarkdown, type IntakeExportLabels } from "./intake-export.ts";

const labels: IntakeExportLabels = {
  title: "Role intake",
  role: "Role",
  seniority: "Level",
  outcomes: "Done in 90 days",
  dealbreakers: "Dealbreakers",
  niceToHave: "Nice to have",
  languages: "Languages",
  context: "Context",
  transcript: "Transcript",
  provenance: { stated: "they said", inferred: "AI reading", default: "assumed" },
  weight: "weight",
  confidence: "confidence",
  fromTurn: "turn",
  agent: "Agent",
  requestor: "Requestor",
  system: "System",
};

test("export carries grading, provenance and turn citations that match the numbered transcript", () => {
  const md = buildIntakeExportMarkdown(
    {
      title: "Java Developer",
      brief: {
        title: "Java Developer",
        seniority: "senior",
        spineProvenance: { seniority: "stated" },
        successCriteria: ["On-call runs without gaps"],
        requirements: [
          { skill: "Java", kind: "must_have", hardness: "prerequisite", weight: 0.8, rationale: "core stack", provenance: "stated", confidence: 0.9, sourceTurn: 7 },
        ],
        facets: [{ key: "urgency", label: "Urgency", value: "quarter", importance: "core", provenance: "stated", confidence: 0.9, sourceTurn: 9 }],
      },
      transcript: [
        { role: "interviewer", text: "opener" },
        { role: "candidate", text: "backfill" },
      ],
    },
    labels
  );
  assert.ok(md.includes("**Java** · weight 80% · confidence 90% · they said · turn [7]"));
  assert.ok(md.includes("  - core stack"));
  assert.ok(md.includes("**Urgency**: quarter"));
  assert.ok(md.includes("turn [9]"));
  assert.ok(md.includes("**[0] Agent:** opener"));
  assert.ok(md.includes("**[1] Requestor:** backfill"));
  // A stated seniority carries no warning marker; the section renders its provenance.
  assert.ok(md.includes("Level: senior (they said)"));
  assert.ok(!md.includes("(they said) ⚠"));
});

test("a defaulted seniority is visibly flagged in the export", () => {
  const md = buildIntakeExportMarkdown(
    { title: "X", brief: { title: "X", seniority: "medior", spineProvenance: {} }, transcript: [] },
    labels
  );
  assert.ok(md.includes("(assumed) ⚠"));
});
