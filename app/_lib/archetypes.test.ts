// The FAIRNESS GATE has no test. It is the most compliance-critical predicate in
// the app — `isFairnessProtected` is what stops the auto-reject sweep
// (app/_lib/screen-wave.ts) from rejecting a candidate class we promised never to
// auto-reject, and DecisionRulesModal advertises that promise to the operator.
//
// Its one live bug was fixed by a COMMENT and nothing else: ARCHETYPE_LABEL comes
// from Object.fromEntries, so it inherits Object.prototype, and the original
// membership check used `in`, which walks that chain. `"constructor" in
// ARCHETYPE_LABEL` was therefore TRUE for an id the registry has never heard of —
// inverting the fail-closed promise exactly where it matters: isFairnessProtected
// returned FALSE for an unknown archetype, handing the sweep a candidate it was
// supposed to shield. A fix held in place by prose alone is one refactor from
// regressing (Object.hasOwn back to `in` reads like a simplification), so this
// pins the behaviour instead of the implementation.
import { test } from "node:test";
import assert from "node:assert/strict";
import archetypeRegistry from "@/pipeline/jobfit/archetypes.json" with { type: "json" };
import {
  ARCHETYPE_LABEL,
  FAIRNESS_PROTECTED_ARCHETYPES,
  archetypeDisplayKey,
  isEarlyCareer,
  isFairnessProtected,
  isKnownArchetype,
  normalizeArchetype
} from "./archetypes.ts";

const REGISTRY = archetypeRegistry.archetypes as { id: string; fairnessProtected: boolean; scoringModel: string }[];

// The prototype-chain hole, and its neighbours. Every one of these is an id the
// registry has never heard of, so every one must be SHIELDED (fail closed) and must
// NOT be reported as a known archetype.
const PROTOTYPE_NAMES = ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty", "prototype"];

test("a prototype name is never mistaken for a registered archetype", () => {
  for (const name of PROTOTYPE_NAMES) {
    assert.equal(isKnownArchetype(name), false, `isKnownArchetype(${JSON.stringify(name)}) must be false`);
    assert.equal(
      isFairnessProtected(name),
      true,
      `${JSON.stringify(name)} is not a registered archetype, so the gate must FAIL CLOSED and shield it`
    );
    assert.equal(
      archetypeDisplayKey(name),
      "unrouted",
      `${JSON.stringify(name)} must display as the honest "unrouted", never as a concrete class`
    );
  }
});

test("`constructor` specifically — the id that made the gate return false", () => {
  // Named on its own because it is the ONE prototype key that survives
  // normalizeArchetype's lower-casing (toString/valueOf do not), so it was the live
  // hole rather than a theoretical one. A regression here is a real candidate
  // auto-rejected out of a shielded class.
  assert.equal(isFairnessProtected("constructor"), true);
  assert.equal(isFairnessProtected("Constructor"), true, "normalization must not open the hole back up");
  assert.equal(isFairnessProtected("  CONSTRUCTOR  "), true, "nor trimming + case folding together");
  assert.equal(ARCHETYPE_LABEL.constructor === undefined, false, "the inherited property IS still reachable…");
  assert.equal(Object.hasOwn(ARCHETYPE_LABEL, "constructor"), false, "…which is exactly why own-key membership is the check");
});

test("an unknown / absent / blank archetype is shielded — the gate fails closed", () => {
  for (const unknown of [null, undefined, "", "   ", "unknown", "unrouted", "quantum_alchemist", "bau_v2"]) {
    assert.equal(
      isFairnessProtected(unknown),
      true,
      `${JSON.stringify(unknown)} cannot be classified, so it must never be auto-rejectable`
    );
  }
});

test("every archetype the registry marks fairnessProtected is shielded", () => {
  const protectedIds = REGISTRY.filter((a) => a.fairnessProtected).map((a) => a.id);
  assert.ok(protectedIds.length > 0, "the registry must declare at least one protected archetype");
  assert.deepEqual(
    [...FAIRNESS_PROTECTED_ARCHETYPES].sort(),
    [...protectedIds].sort(),
    "the exported set must be derived from the registry, never hand-copied"
  );
  for (const id of protectedIds) {
    assert.equal(isKnownArchetype(id), true, `${id} is in the registry`);
    assert.equal(isFairnessProtected(id), true, `${id} is flagged fairnessProtected`);
    // Case and whitespace are how these ids arrive from a CV, an apply form and the
    // Python pipeline; a shield that only holds for the canonical spelling is not one.
    assert.equal(isFairnessProtected(id.toUpperCase()), true, `${id} upper-cased`);
    assert.equal(isFairnessProtected(`  ${id} `), true, `${id} padded`);
  }
});

test("an UNPROTECTED registered archetype is auto-rejectable — the gate is not vacuous", () => {
  // Without this the whole suite would pass on `isFairnessProtected = () => true`,
  // which shields everyone and quietly disables the auto-reject feature instead.
  const open = REGISTRY.filter((a) => !a.fairnessProtected).map((a) => a.id);
  assert.ok(open.length > 0, "the registry must declare at least one non-protected archetype");
  for (const id of open) {
    assert.equal(isKnownArchetype(id), true, `${id} is in the registry`);
    assert.equal(isFairnessProtected(id), false, `${id} is NOT fairnessProtected, so the sweep may act on it`);
  }
});

test("isEarlyCareer is a positive classification — unknown is NOT early", () => {
  // Deliberately the opposite default from the fairness gate: this drives display
  // grouping and encouraging copy, so over-claiming an unknown candidate as
  // early-career would misinform, where over-shielding one merely costs a manual
  // review. The two must not be collapsed into each other.
  for (const unknown of [null, undefined, "", "constructor", "quantum_alchemist"]) {
    assert.equal(isEarlyCareer(unknown), false, `${JSON.stringify(unknown)} must not be claimed as early-career`);
    assert.equal(isFairnessProtected(unknown), true, "…while the safety gate still shields it");
  }
  for (const a of REGISTRY) {
    assert.equal(isEarlyCareer(a.id), a.scoringModel === "early_career", `${a.id} follows the registry's scoringModel`);
  }
});

test("archetypeDisplayKey never invents a concrete class", () => {
  for (const a of REGISTRY) {
    assert.equal(archetypeDisplayKey(a.id), a.id);
    assert.equal(archetypeDisplayKey(` ${a.id.toUpperCase()} `), a.id, "normalized, not rejected");
  }
  // "unknown" is the sentinel the matcher stamps when routing could not classify a
  // candidate. Collapsing it to "bau" would both misinform the recruiter AND, if that
  // "bau" were persisted, strip the fail-closed shield downstream.
  assert.equal(archetypeDisplayKey("unknown"), "unrouted");
  assert.notEqual(archetypeDisplayKey("unknown"), "bau");
});

test("normalizeArchetype is the one canonical form both predicates agree on", () => {
  assert.equal(normalizeArchetype(" Student "), "student");
  assert.equal(normalizeArchetype(null), "");
  assert.equal(normalizeArchetype(undefined), "");
});
