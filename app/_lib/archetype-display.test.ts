// candidate-profile-job-matching #3(b): the UI must NEVER relabel an unrouted
// candidate as a concrete class. `archetypeDisplayKey` maps a missing archetype,
// the matcher's "unknown" fail-closed sentinel, and any unregistered id to the
// honest "unrouted" display key — never "bau" ("Experienced"). Mislabeling a
// fairness-protected candidate as "bau" both misinforms the recruiter and, if that
// "bau" is persisted, strips the fail-closed shield downstream.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// archetypes.ts imports the "@/pipeline/jobfit/archetypes.json" registry — the
// same three-way (alias / extensionless / json) resolution the sibling db + fairness
// tests install so the REAL module (not a copy) is exercised.
const ROOT = new URL("../../", import.meta.url).href;
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

const { archetypeDisplayKey, isFairnessProtected } = await import("./archetypes.ts");

test("unknown / missing / unregistered archetypes display as 'unrouted', NEVER 'bau'", () => {
  for (const v of [null, undefined, "", "unknown", "not_a_real_archetype", "  UNKNOWN  "]) {
    assert.equal(archetypeDisplayKey(v), "unrouted", `${JSON.stringify(v)} must be unrouted`);
    assert.notEqual(archetypeDisplayKey(v), "bau");
  }
});

test("a known archetype keeps its canonical (normalized) key", () => {
  assert.equal(archetypeDisplayKey("bau"), "bau");
  assert.equal(archetypeDisplayKey("student"), "student");
  assert.equal(archetypeDisplayKey(" Career_Switcher "), "career_switcher");
});

test("the display shift is consistent with the fairness gate: everything shown as unrouted is shielded", () => {
  // The exact hazard the fix closes: an unrouted candidate must stay fairness-
  // protected (the old "bau" fallback was NOT — isFairnessProtected('bau') is false).
  for (const v of [null, "unknown", "mystery_class"]) {
    assert.equal(archetypeDisplayKey(v), "unrouted");
    assert.equal(isFairnessProtected(v), true, `${JSON.stringify(v)} must be shielded`);
  }
  assert.equal(isFairnessProtected("bau"), false, "bau is NOT shielded — precisely why it can't be the fallback");
});
