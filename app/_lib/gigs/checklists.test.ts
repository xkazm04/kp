// The per-arena review checklists (checklists.ts). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GIG_ARENAS, GIG_DISCLOSURE_ITEM } from "./types.ts";
import { GIG_CHECKLISTS, GIG_CHECKLIST_MEANING, allGigChecklistKeys, gigChecklist } from "./checklists.ts";

test("every arena has 5-7 unique items, ending with the disclosure item", () => {
  for (const arena of GIG_ARENAS) {
    const items = GIG_CHECKLISTS[arena];
    assert.ok(items.length >= 5 && items.length <= 7, `${arena} has ${items.length} items`);
    assert.equal(new Set(items).size, items.length, `${arena} repeats an item`);
    assert.equal(items[items.length - 1], GIG_DISCLOSURE_ITEM, `${arena} must end with the disclosure item`);
  }
});

test("items are stable snake_case keys and every key has a meaning for the specialist prompt", () => {
  for (const key of allGigChecklistKeys()) {
    assert.match(key, /^[a-z][a-z_]*$/, `${key} is not a stable key`);
    assert.ok((GIG_CHECKLIST_MEANING[key] ?? "").length > 10, `${key} has no meaning line`);
  }
});

test("gigChecklist hands out a fresh copy", () => {
  const a = gigChecklist("security");
  a.push("mutated");
  assert.ok(!gigChecklist("security").includes("mutated"));
});

test("the freelance checklist is the PROPOSAL track's: the asks and the proposal file, disclosure last", () => {
  assert.deepEqual(GIG_CHECKLISTS.freelance, ["brief_answered", "scope_honest", "no_overclaim", "asks_included", "proposal_attached", "no_off_platform", GIG_DISCLOSURE_ITEM]);
  assert.ok(!GIG_CHECKLISTS.freelance.includes("deliverable_verified"), "a proposal is not a verified deliverable");
  // A review stored before the tracks split still reads: the retired key keeps its meaning.
  assert.ok((GIG_CHECKLIST_MEANING.deliverable_verified ?? "").length > 10);
});
