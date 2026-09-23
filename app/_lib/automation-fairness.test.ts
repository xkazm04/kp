// Pins the TS-side defense-in-depth fairness backstop (idea-15b8f70e). The policy
// pass applies Python's reject decisions; this re-check is the only thing between a
// Python regression and a silent unfair auto-reject, so its gate must match
// `evaluate_entry`'s SOLE reject path exactly: a known, non-protected (BAU)
// archetype with a genuine score strictly below the reject floor — nothing else.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The module under test transitively imports the "@/*" alias, an extensionless TS
// sibling (./archetypes), and a JSON file without an import attribute — all three
// are how Next/tsc resolve, but none work under the bare `node --test` runner.
// Install minimal module hooks so we load the REAL module (a copied-out gate could
// never catch the module itself drifting). Scoped to this file's process (node
// --test isolates files); only touches "@/", relative/extensionless, and .json.
const ROOT = new URL("../../", import.meta.url).href; // repo root (app/_lib/ -> ../../)
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = new URL(spec.slice(2), ROOT).href; // tsconfig "@/*"
    else if ((spec.startsWith("./") || spec.startsWith("../")) && context.parentURL) {
      spec = new URL(spec, context.parentURL).href; // relative -> file: so we can test for .ts
    }
    // "No extension" is judged by the file, not a regex: the live registry reader's graph
    // reaches `@/app/_lib/taxonomy.generated`, whose dotted stem looks like an extension.
    if (spec.startsWith("file:") && !/\.(ts|tsx|js|mjs|cjs|json)$/i.test(spec) && existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts"; // extensionless import, e.g. "./archetypes"
    }
    return nextResolve(spec, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      // Wrap JSON as an ES module so the missing `type: json` attribute is moot.
      const source = "export default " + readFileSync(fileURLToPath(url), "utf8") + ";";
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { assertAutoRejectFair, BAU_REJECT_SCORE } = await import("./automation-fairness.ts");

// The one combination evaluate_entry actually rejects on: BAU, scored, below floor.
test("allows the only legitimate auto-reject: BAU with a genuine sub-floor score", () => {
  assert.deepEqual(assertAutoRejectFair({ archetype: "bau", matchScore: 35 }), { allowed: true });
  // Just under the floor is still allowed.
  assert.deepEqual(assertAutoRejectFair({ archetype: "bau", matchScore: BAU_REJECT_SCORE - 1 }), { allowed: true });
});

test("refuses a reject for an early-career (fairness-protected) archetype", () => {
  for (const archetype of ["student", "career_switcher"]) {
    // Even a genuinely low score must not auto-reject an early-career candidate.
    const v = assertAutoRejectFair({ archetype, matchScore: 10 });
    assert.equal(v.allowed, false, archetype);
    if (!v.allowed) assert.match(v.reason, /early-career/);
  }
});

test("refuses a reject for an unknown / renamed archetype (fail closed)", () => {
  for (const archetype of ["wizard", "", null]) {
    const v = assertAutoRejectFair({ archetype, matchScore: 10 });
    assert.equal(v.allowed, false, String(archetype));
    if (!v.allowed) assert.match(v.reason, /unknown archetype/);
  }
});

test("refuses a reject for an unscored entry (null or 0 — a data gap, not a low match)", () => {
  for (const matchScore of [null, 0]) {
    const v = assertAutoRejectFair({ archetype: "bau", matchScore });
    assert.equal(v.allowed, false, String(matchScore));
    if (!v.allowed) assert.match(v.reason, /unscored/);
  }
});

test("refuses a reject at or above the reject floor (BAU, but not a low-enough match)", () => {
  for (const matchScore of [BAU_REJECT_SCORE, BAU_REJECT_SCORE + 5, 90]) {
    const v = assertAutoRejectFair({ archetype: "bau", matchScore });
    assert.equal(v.allowed, false, String(matchScore));
    if (!v.allowed) assert.match(v.reason, /reject floor/);
  }
});

test("refuses (fails closed) when the entry can't be found for the re-check", () => {
  for (const entry of [null, undefined]) {
    const v = assertAutoRejectFair(entry);
    assert.equal(v.allowed, false);
    if (!v.allowed) assert.match(v.reason, /fail closed/);
  }
});

test("BAU_REJECT_SCORE mirrors the Python POLICY floor (must stay >= it)", () => {
  // Pins the cross-language mirror — see automation-fairness.ts. The Python half is
  // pinned by pipeline/jobfit/tests/test_automation.py (test_bau_low_rejects @ 35).
  assert.equal(BAU_REJECT_SCORE, 40);
});

// --- the LIVE registry ---------------------------------------------------------
// Python's automation.py derives its early-career set from archetypes.json on every
// spawn; this backstop used to answer from the copy bundled at build time, so a custom
// archetype registered (or re-shielded) at runtime was re-checked against a registry
// that had never heard of it. The re-check now reads the same live file.
test("a custom archetype shielded in the LIVE registry is refused as protected, not as 'unknown'", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { setLiveRegistryPathForTest } = await import("./archetype-live.ts");
  const bundled = JSON.parse(readFileSync(fileURLToPath(new URL("../../pipeline/jobfit/archetypes.json", import.meta.url)), "utf8"));
  bundled.archetypes.push({
    id: "ops_lead",
    label: "Operations lead",
    badge: "Ops lead",
    fairnessProtected: true,
    scoringModel: "experienced",
    weights: { skills: 0.5, career: 0.35, personal: 0.15 },
    dimensionLabels: { skills: "Skills", career: "Career", personal: "Personal" },
    checklist: [],
  });
  const dir = mkdtempSync(path.join(tmpdir(), "kp-fairness-live-"));
  const file = path.join(dir, "archetypes.json");
  writeFileSync(file, JSON.stringify(bundled), "utf8");
  setLiveRegistryPathForTest(file);
  try {
    const v = assertAutoRejectFair({ archetype: "ops_lead", matchScore: 20 });
    assert.equal(v.allowed, false);
    if (!v.allowed) {
      assert.match(v.reason, /shielded from automated rejection/);
      assert.doesNotMatch(v.reason, /unknown archetype/, "it is registered - just not in the build-time copy");
    }
    // The same live file, shield off: now a legitimate BAU-path reject.
    bundled.archetypes[bundled.archetypes.length - 1].fairnessProtected = false;
    writeFileSync(file, JSON.stringify(bundled, null, 1), "utf8");
    assert.deepEqual(assertAutoRejectFair({ archetype: "ops_lead", matchScore: 20 }), { allowed: true });
  } finally {
    setLiveRegistryPathForTest(null);
    rmSync(dir, { recursive: true, force: true });
  }
});
