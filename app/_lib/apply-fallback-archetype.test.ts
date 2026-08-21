// craft-scan-2026-08-20 P1: a DEGRADED intake must not be persisted as a concrete
// archetype. `FALLBACK_ARCHETYPE` used to be "bau" ("Experienced"), so a candidate
// whose CV parse broke was recorded as an experienced professional — losing the
// early-career fairness shield and picking up the seniority KO floor, on a record
// asserting nothing was read. It must be the "unknown" fail-closed sentinel that
// `archetypes.ts` (and the Python matcher) already shield.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// apply.ts / archetypes.ts import the "@/pipeline/jobfit/archetypes.json" registry —
// the same three-way (alias / extensionless / json) resolution the sibling
// archetype-display test installs so the REAL modules are exercised.
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

const { FALLBACK_ARCHETYPE } = await import("./apply.ts");
const { isFairnessProtected, isKnownArchetype, isEarlyCareer, archetypeDisplayKey } = await import("./archetypes.ts");

test("the degraded-intake archetype is the 'unknown' sentinel, never a concrete class", () => {
  assert.equal(FALLBACK_ARCHETYPE, "unknown");
  assert.notEqual(FALLBACK_ARCHETYPE, "bau");
  // The property that matters, not just the literal: whatever this value is, the
  // registry must NOT recognize it as a real class — a recognized id would be a
  // guess about a candidate nothing was read from.
  assert.equal(isKnownArchetype(FALLBACK_ARCHETYPE), false);
});

test("a degraded intake keeps the fail-closed fairness shield and renders as unrouted", () => {
  // The shield: unclassified is never fair game for automated rejection.
  assert.equal(isFairnessProtected(FALLBACK_ARCHETYPE), true);
  assert.equal(isFairnessProtected("bau"), false); // what the old fallback bought us
  // Display: honest "unrouted", not a relabel to a concrete class.
  assert.equal(archetypeDisplayKey(FALLBACK_ARCHETYPE), "unrouted");
  // But it must NOT over-claim early-career either — that gate drives encouraging
  // copy and grouping, and we know nothing about this candidate.
  assert.equal(isEarlyCareer(FALLBACK_ARCHETYPE), false);
});
