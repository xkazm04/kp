// sanitizeEditedBrief — the trust boundary for human brief edits (UAT drain
// §2.1). Pins the floor semantics: per-field degrade, enum/range clamps,
// entry caps; whole-reject only for a non-object payload.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeEditedBrief, withEditProvenance } from "./brief-edit.ts";
import type { RoleBrief } from "./rolespec.ts";

test("a clean human edit passes through with its provenance claims", () => {
  const out = sanitizeEditedBrief({
    title: "Data Analyst",
    seniority: "senior",
    roleFamily: "data_ai",
    requirements: [
      { skill: "SQL", kind: "must_have", hardness: "prerequisite", weight: 0.9, rationale: "reporting", provenance: "stated", confidence: 1, sourceTurn: 3 },
    ],
    facets: [{ key: "urgency", label: "Urgency", value: "now", importance: "core", provenance: "stated", confidence: 1, sourceTurn: 5 }],
    spineProvenance: { seniority: "stated" },
    successCriteria: ["Weekly reporting runs itself"],
  });
  assert.ok(out);
  assert.equal(out.requirements?.[0].sourceTurn, 3);
  assert.equal(out.spineProvenance?.seniority, "stated");
  assert.equal(out.seniority, "senior");
});

test("malformed fields degrade per-field, never reject the whole edit", () => {
  const out = sanitizeEditedBrief({
    title: 42,
    seniority: "Band 5", // off-vocab → default
    requirements: [
      { skill: "SQL", kind: "MUST", weight: 7, confidence: -2, sourceTurn: "three" },
      { skill: "" }, // no skill → dropped
      "garbage",
    ],
    facets: [{ key: "x", value: "" }],
    languages: ["en", 5, "cs"],
  });
  assert.ok(out);
  assert.equal(out.title, "");
  assert.equal(out.seniority, "medior");
  assert.equal(out.requirements?.length, 1);
  const req = out.requirements![0];
  assert.equal(req.kind, "must_have");
  assert.equal(req.weight, 1); // 7 clamps
  assert.equal(req.confidence, 0); // -2 clamps
  assert.equal(req.sourceTurn, null);
  assert.deepEqual(out.facets, []);
  assert.deepEqual(out.languages, ["en", "cs"]);
});

test("withEditProvenance flips only changed/new entries to stated", () => {
  const original: RoleBrief = {
    title: "Java Developer",
    seniority: "senior",
    spineProvenance: { seniority: "stated" },
    requirements: [
      { skill: "Java", kind: "must_have", hardness: "prerequisite", weight: 0.8, rationale: "", provenance: "stated", confidence: 0.9, sourceTurn: 7 },
      { skill: "Kafka", kind: "must_have", hardness: "prerequisite", weight: 0.8, rationale: "", provenance: "inferred", confidence: 0.6, sourceTurn: 7 },
    ],
    facets: [
      { key: "urgency", label: "Urgency", value: "quarter", importance: "core", provenance: "stated", confidence: 0.9, sourceTurn: 9 },
    ],
  };
  const edited: RoleBrief = structuredClone(original);
  edited.requirements![1] = { ...edited.requirements![1], kind: "nice_to_have" }; // human demotes Kafka
  edited.requirements!.push({
    skill: "Messaging", kind: "must_have", hardness: "prerequisite", weight: 0.5, rationale: "", provenance: "default", confidence: 0.5, sourceTurn: null,
  });
  const out = withEditProvenance(original, edited);
  const bySkill = Object.fromEntries(out.requirements!.map((r) => [r.skill, r]));
  // Untouched keeps its provenance + trace.
  assert.equal(bySkill.Java.provenance, "stated");
  assert.equal(bySkill.Java.confidence, 0.9);
  assert.equal(bySkill.Java.sourceTurn, 7);
  // Changed flips to stated/1.0, keeps the original trace.
  assert.equal(bySkill.Kafka.provenance, "stated");
  assert.equal(bySkill.Kafka.confidence, 1);
  assert.equal(bySkill.Kafka.sourceTurn, 7);
  // New entry is stated with no trace (typed, not spoken).
  assert.equal(bySkill.Messaging.provenance, "stated");
  assert.equal(bySkill.Messaging.sourceTurn, null);
  // Unchanged facet + unchanged spine stay as they were.
  assert.equal(out.facets?.[0].provenance, "stated");
  assert.equal(out.facets?.[0].sourceTurn, 9);
  assert.equal(out.spineProvenance?.seniority, "stated");
  // A spine change flips its provenance.
  const retitled = withEditProvenance(original, { ...structuredClone(original), title: "Release Engineer" });
  assert.equal(retitled.spineProvenance?.title, "stated");
});

test("only a non-object payload rejects outright; caps hold", () => {
  assert.equal(sanitizeEditedBrief(null), null);
  assert.equal(sanitizeEditedBrief("brief"), null);
  assert.equal(sanitizeEditedBrief([1]), null);
  const out = sanitizeEditedBrief({
    requirements: Array.from({ length: 40 }, (_, i) => ({ skill: `S${i}` })),
  });
  assert.equal(out?.requirements?.length, 24);
});
