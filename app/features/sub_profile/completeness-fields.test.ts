// candidate-profile-job-matching #2: the result panel's "Add next" gaps become
// clickable jumps to the field that resolves them. fieldTargetForMissing maps the
// human labels profile_cli emits (sourced from archetypes.json) to an editor field
// key. This pins the mapping against the REAL registry so a label edit there that
// breaks the join fails CI here instead of silently making a gap inert again.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The module imports "@/pipeline/jobfit/archetypes.json" — install the same
// alias/extensionless/json resolution the sibling db + archetype tests use.
const ROOT = new URL("../../../", import.meta.url).href; // sub_profile/ -> repo root
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href;
    else if ((spec.startsWith("./") || spec.startsWith("../")) && context.parentURL) {
      spec = new URL(spec, context.parentURL).href;
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts";
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const source = "export default " + readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const registry = (await import("@/pipeline/jobfit/archetypes.json")).default as {
  commonChecklist: { check: string; label: string }[];
  archetypes: { checklist: { check: string; label: string }[] }[];
};
const { fieldTargetForMissing, fieldTargetForCheck, FIELD_DOM_ID } = await import("./completeness-fields.ts");

test("common-checklist labels route to the right field", () => {
  assert.equal(fieldTargetForMissing("languages"), "languages");
  assert.equal(fieldTargetForMissing("education level"), "educationLevel");
  assert.equal(fieldTargetForMissing("at least 3 skills"), "skills");
});

test("experienced (bau) and early-career labels route correctly", () => {
  assert.equal(fieldTargetForMissing("seniority"), "seniority");
  assert.equal(fieldTargetForMissing("years of experience"), "years");
  assert.equal(fieldTargetForMissing("a work-experience entry"), "evidence");
  assert.equal(fieldTargetForMissing("target roles / aspirations"), "aspirations");
  assert.equal(fieldTargetForMissing("study programme & specialisation"), "educationDetail");
  assert.equal(fieldTargetForMissing("a project or thesis (your strongest evidence)"), "evidence");
});

test("EVERY registry checklist label resolves to a known field id (no silent inert gap)", () => {
  const labels = [
    ...registry.commonChecklist.map((c) => c.label),
    ...registry.archetypes.flatMap((a) => a.checklist.map((c) => c.label)),
  ];
  for (const label of labels) {
    const target = fieldTargetForMissing(label);
    assert.ok(target, `registry label "${label}" must map to a field`);
    assert.ok(target! in FIELD_DOM_ID, `field "${target}" must have a DOM anchor`);
  }
});

test("an unrecognized label stays null (rendered as plain text, not a broken jump)", () => {
  assert.equal(fieldTargetForMissing("something the registry never emits"), null);
  assert.equal(fieldTargetForMissing(""), null);
});

// The id-join (fieldTargetForCheck) is what makes the LOCALIZED "Add next" gaps
// clickable — it keys off the stable registry `check` id profile_cli now emits in
// `missingGaps`, so a translated (or reworded) label can never make a gap inert.
test("EVERY registry check id routes to a known field via the id-join", () => {
  const checks = [
    ...registry.commonChecklist.map((c) => c.check),
    ...registry.archetypes.flatMap((a) => a.checklist.map((c) => c.check)),
  ];
  for (const check of checks) {
    const target = fieldTargetForCheck(check);
    assert.ok(target, `registry check "${check}" must map to a field`);
    assert.ok(target! in FIELD_DOM_ID, `field "${target}" must have a DOM anchor`);
  }
});

test("an unmapped check id stays null (degrades to plain text)", () => {
  assert.equal(fieldTargetForCheck("has_teleportation"), null);
  assert.equal(fieldTargetForCheck(""), null);
});
