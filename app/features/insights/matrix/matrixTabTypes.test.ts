// match-card-shows-the-unproven-middle (c). `archStyle` and `STAGE_INITIAL` are the two
// places the grid turns an OPEN vocabulary (archetype ids from the shared registry,
// pipeline stage names) into fixed presentation, and neither was tested. The failure
// mode that matters is silent MISLABELLING: `archStyle` falls back to "bau" for a
// null/blank archetype, and an earlier revision reached that same fallback for an
// UNKNOWN archetype too — so a newly registered archetype would have rendered with the
// steel dot and the "Experienced" label instead of its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { archStyle, STAGE_INITIAL } from "./matrixTabTypes.ts";
import { ARCHETYPE_LABEL, normalizeArchetype } from "@/app/_lib/archetypes.ts";

test("a blank/absent archetype degrades to the experienced default", () => {
  for (const blank of [null, "", "   "]) {
    assert.equal(archStyle(blank).id, "bau", `${JSON.stringify(blank)} → bau`);
    assert.equal(archStyle(blank).bg, "bg-steel");
  }
});

test("an UNKNOWN archetype never mislabels as bau — it keeps its own id, neutral dot", () => {
  const a = archStyle("quantum_alchemist");
  assert.notEqual(a.id, "bau", "an unrecognized archetype must not be reported as Experienced");
  assert.equal(a.id, normalizeArchetype("quantum_alchemist"), "the id is whatever the registry normalizer says");
  assert.equal(a.bg, "bg-stone-400", "no configured colour → the neutral dot, not another archetype's");
});

test("every registered archetype resolves to its OWN id (label comes from the id)", () => {
  // ARCHETYPE_LABEL, not the deleted ARCHETYPE_BADGE: both were keyed by the same
  // registry ids, and only the id vocabulary is what this test needs.
  for (const id of Object.keys(ARCHETYPE_LABEL)) {
    assert.equal(archStyle(id).id, id, `${id} must keep its identity`);
    assert.equal(typeof archStyle(id).bg, "string");
    assert.ok(archStyle(id).bg.length > 0, `${id} needs some dot class`);
  }
});

test("STAGE_INITIAL is a lookup, not an assertion: an unknown stage yields nothing", () => {
  // The grid renders `STAGE_INITIAL[stage] ?? ""`. A new pipeline stage must show a
  // blank corner marker rather than borrowing another stage's letter.
  assert.equal(STAGE_INITIAL["Shortlisted"], undefined);
  assert.equal(STAGE_INITIAL[""], undefined);
  const letters = Object.values(STAGE_INITIAL);
  assert.equal(new Set(letters).size, letters.length, "two stages sharing a letter would be unreadable");
  for (const l of letters) assert.match(l, /^[A-Z]$/);
});
