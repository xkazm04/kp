// sanitizeEditedBrief — the trust boundary for human brief edits (UAT drain
// §2.1). Pins the floor semantics: per-field degrade, enum/range clamps,
// entry caps; whole-reject only for a non-object payload — and the provenance
// rule the boundary owns: resolved from (stored, incoming), never taken on the
// caller's word alone.
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
  }, null);
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
  }, null);
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
  assert.equal(sanitizeEditedBrief(null, null), null);
  assert.equal(sanitizeEditedBrief("brief", null), null);
  assert.equal(sanitizeEditedBrief([1], null), null);
  const out = sanitizeEditedBrief({
    requirements: Array.from({ length: 40 }, (_, i) => ({ skill: `S${i}` })),
  }, null);
  assert.equal(out?.requirements?.length, 24);
});

// ---------------------------------------------------------------------------
// The provenance rule at the HTTP door. `sanitizeEditedBrief` now takes the
// STORED brief, so provenance is decided from (stored, incoming) — the same
// non-regression pipeline/jobfit/intake.py::merge_brief enforces on the
// extraction path, landed on the edit path where only the browser enforced it.
// ---------------------------------------------------------------------------

/** A stored brief whose grading is a mix of what the requestor said and what
 *  the model guessed — the shape the rule has to defend. */
function storedBrief(): RoleBrief {
  return {
    title: "Java Developer",
    seniority: "senior",
    roleFamily: "software_engineering",
    spineProvenance: { title: "stated", seniority: "stated", role_family: "inferred" },
    requirements: [
      { skill: "Java", kind: "must_have", hardness: "prerequisite", weight: 0.8, rationale: "the service is Java", provenance: "stated", confidence: 0.95, sourceTurn: 7 },
      { skill: "Kafka", kind: "must_have", hardness: "prerequisite", weight: 0.6, rationale: "", provenance: "inferred", confidence: 0.6, sourceTurn: 7 },
    ],
    facets: [
      { key: "urgency", label: "Urgency", value: "quarter", importance: "core", provenance: "stated", confidence: 0.9, sourceTurn: 9 },
      { key: "budget", label: "Budget", value: "unclear", importance: "valuable", provenance: "inferred", confidence: 0.4, sourceTurn: 9 },
    ],
  };
}

test("a PATCH cannot downgrade a stated grading to inferred or default", () => {
  const stored = storedBrief();
  const out = sanitizeEditedBrief({
    ...stored,
    // Every claim on the wire is a downgrade of something the requestor said.
    requirements: [
      { ...stored.requirements![0], provenance: "inferred", confidence: 0.1, sourceTurn: 99 },
      { ...stored.requirements![1], provenance: "default" },
    ],
    facets: [
      { ...stored.facets![0], provenance: "default", confidence: 0.1, sourceTurn: 99 },
      { ...stored.facets![1], provenance: "default" },
    ],
    spineProvenance: { title: "inferred", seniority: "default", role_family: "default" },
  }, stored);
  assert.ok(out);
  const req = Object.fromEntries(out.requirements!.map((r) => [r.skill, r]));
  // The stated basis survives — and so does the trace behind it, since the
  // attribution kept is the record's, not the payload's.
  assert.equal(req.Java.provenance, "stated");
  assert.equal(req.Java.confidence, 0.95);
  assert.equal(req.Java.sourceTurn, 7);
  // A merely-inferred row is NOT protected — the rule guards `stated` only,
  // exactly as merge_brief does.
  assert.equal(req.Kafka.provenance, "default");
  const facets = Object.fromEntries(out.facets!.map((f) => [f.key, f]));
  assert.equal(facets.urgency.provenance, "stated");
  assert.equal(facets.urgency.confidence, 0.9);
  assert.equal(facets.urgency.sourceTurn, 9);
  assert.equal(facets.budget.provenance, "default");
  // Spine scalars are held to the same rule.
  assert.equal(out.spineProvenance?.title, "stated");
  assert.equal(out.spineProvenance?.seniority, "stated");
  assert.equal(out.spineProvenance?.role_family, "default");
});

test("a payload with no provenance at all cannot mint a stated row", () => {
  const stored = storedBrief();
  // A row that makes no provenance claim at all — the shape any caller that
  // is not the edit form produces.
  const strip = (row: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(row).filter(([k]) => k !== "provenance"));
  const out = sanitizeEditedBrief({
    ...stored,
    requirements: [
      strip(stored.requirements![1]), // unchanged: inherits the record's `inferred`
      { skill: "Rust", kind: "must_have", hardness: "prerequisite", weight: 0.5, rationale: "", confidence: 1 }, // brand new, unattributed
      { ...strip(stored.requirements![0]), kind: "nice_to_have" }, // re-graded, unattributed
    ],
    facets: [strip(stored.facets![1]), { key: "shift", label: "Shift", value: "nights", importance: "core" }],
    spineProvenance: {},
  }, stored);
  assert.ok(out);
  const req = Object.fromEntries(out.requirements!.map((r) => [r.skill, r]));
  // Unchanged + no claim: the record's own grading, trace included.
  assert.equal(req.Kafka.provenance, "inferred");
  assert.equal(req.Kafka.confidence, 0.6);
  assert.equal(req.Kafka.sourceTurn, 7);
  // New + no claim: `default`. The old floor stamped this "stated" — an
  // unattributed row wearing the requestor's own words.
  assert.equal(req.Rust.provenance, "default");
  // Re-graded + no claim: unattributed too — except that Java was `stated` on
  // the record, and a stated grading never regresses.
  assert.equal(req.Java.provenance, "stated");
  assert.equal(out.facets!.find((f) => f.key === "budget")?.provenance, "inferred");
  assert.equal(out.facets!.find((f) => f.key === "shift")?.provenance, "default");
  // Nothing was claimed for the spine and nothing changed, so the record stands.
  assert.equal(out.spineProvenance?.title, "stated");
  assert.equal(out.spineProvenance?.role_family, "inferred");
});

test("what the requestor actually typed is still stated, and untouched rows are not laundered", () => {
  const stored = storedBrief();
  // The real client path: the form diffs, then PATCHes what the diff claims.
  const edited: RoleBrief = structuredClone(stored);
  edited.requirements![1] = { ...edited.requirements![1], hardness: "learnable" };
  edited.title = "Platform Engineer";
  const out = sanitizeEditedBrief(withEditProvenance(stored, edited), stored);
  assert.ok(out);
  const req = Object.fromEntries(out.requirements!.map((r) => [r.skill, r]));
  // The human re-graded Kafka: an inferred guess becomes the requestor's call.
  assert.equal(req.Kafka.provenance, "stated");
  assert.equal(req.Kafka.confidence, 1);
  assert.equal(req.Kafka.sourceTurn, 7); // the transcript pointer is not invented away
  // Java rode along untouched and keeps the trace it already had.
  assert.equal(req.Java.provenance, "stated");
  assert.equal(req.Java.confidence, 0.95);
  // The untouched inferred facet stays inferred — one edit does not launder the brief.
  assert.equal(out.facets!.find((f) => f.key === "budget")?.provenance, "inferred");
  assert.equal(out.spineProvenance?.title, "stated");
  // A row the requestor DELETED stays deleted; the rule is about rows present.
  const pruned = sanitizeEditedBrief(
    withEditProvenance(stored, { ...structuredClone(stored), requirements: [stored.requirements![1]] }),
    stored
  );
  assert.deepEqual(pruned?.requirements?.map((r) => r.skill), ["Kafka"]);
});

test("a weight the human moved is a stated grade, not an inferred one", () => {
  const stored = storedBrief();
  const edited: RoleBrief = structuredClone(stored);
  edited.requirements![1] = { ...edited.requirements![1], weight: 0.95 }; // only the dial moved
  const claimed = withEditProvenance(stored, edited);
  const kafka = claimed.requirements!.find((r) => r.skill === "Kafka")!;
  assert.equal(kafka.provenance, "stated");
  assert.equal(kafka.weight, 0.95);
  // …and it survives the door.
  const out = sanitizeEditedBrief(claimed, stored);
  assert.equal(out?.requirements?.find((r) => r.skill === "Kafka")?.provenance, "stated");
});
