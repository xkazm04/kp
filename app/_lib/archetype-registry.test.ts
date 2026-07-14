// archetype-registry: structured validation codes + built-in archive protection.
//
// These exercise the PURE paths only — validateArchetype (no I/O) and the built-in
// refusal branch of setArchetypeArchived, which returns BEFORE any registry read/write
// — so the test never mutates the shared archetypes.json on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateArchetype, setArchetypeArchived } from "./archetype-registry.ts";

const valid = {
  label: "Returner",
  scoringModel: "experienced",
  weights: { skills: 0.5, career: 0.35, personal: 0.15 },
  dimensionLabels: { skills: "Skills", career: "Career", personal: "Personal" },
};

test("validateArchetype accepts a well-formed archetype", () => {
  assert.equal(validateArchetype(valid), null);
});

test("validateArchetype returns a structured code + English fallback for a missing label", () => {
  const err = validateArchetype({ ...valid, label: "" });
  assert.equal(err?.code, "label_required");
  assert.match(err!.message, /required/i, "keeps a readable English message for API callers");
});

test("validateArchetype flags a bad weight sum with the sum param", () => {
  const err = validateArchetype({ ...valid, weights: { skills: 0.5, career: 0.3, personal: 0.1 } });
  assert.equal(err?.code, "weights_sum");
  assert.equal(err?.params?.sum, "0.90", "params.sum feeds the localized ICU placeholder");
});

test("validateArchetype names the offending slot for a non-numeric weight", () => {
  const err = validateArchetype({ ...valid, weights: { skills: Number.NaN, career: 0.5, personal: 0.5 } });
  assert.equal(err?.code, "weight_not_number");
  assert.equal(err?.params?.slot, "skills");
});

test("setArchetypeArchived refuses a built-in archetype with an honest reason (no disk write)", async () => {
  const result = await setArchetypeArchived("bau", true);
  assert.ok("error" in result, "built-in archetypes are protected");
  assert.equal(result.error.code, "archive_builtin");
  assert.equal(result.error.params?.id, "bau");
});
