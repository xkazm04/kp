// Pins the two ledger interaction invariants the scan flagged:
//   #2 — tab switches preserve the builder (its typed draft), Duplicate remounts it.
//   #4 — the filter menu's roving arrow-key navigation.
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { switchTab, duplicateToBuilder, nextMenuIndex, type LedgerNavState } from "./jdsLedgerNav.ts";

// --- #2: draft-preserving tab navigation -------------------------------------

test("switching sub-tab keeps the SAME builderKey (no remount → draft preserved)", () => {
  const start: LedgerNavState = { tab: "generate", builderKey: 3 };
  const toSaved = switchTab(start, "saved");
  assert.equal(toSaved.tab, "saved");
  assert.equal(toSaved.builderKey, 3);
  // Round-trip back to generate must still be the SAME key — the pre-fix XOR
  // unmounted the builder on every switch (equivalent to a key change), which is
  // exactly what dropped the typed draft; this assertion fails against that.
  const back = switchTab(toSaved, "generate");
  assert.equal(back.builderKey, 3);
});

test("Duplicate advances builderKey so the builder remounts with the new prefill", () => {
  const start: LedgerNavState = { tab: "saved", builderKey: 3 };
  const dup = duplicateToBuilder(start);
  assert.equal(dup.tab, "generate");
  assert.equal(dup.builderKey, 4);
});

// --- #4: filter-menu roving focus --------------------------------------------

test("nextMenuIndex moves down/up and wraps at both ends", () => {
  assert.equal(nextMenuIndex(0, "ArrowDown", 3), 1);
  assert.equal(nextMenuIndex(2, "ArrowDown", 3), 0); // wrap to first
  assert.equal(nextMenuIndex(0, "ArrowUp", 3), 2); // wrap to last
  assert.equal(nextMenuIndex(1, "ArrowUp", 3), 0);
});

test("nextMenuIndex handles Home/End and ignores non-navigation keys", () => {
  assert.equal(nextMenuIndex(2, "Home", 4), 0);
  assert.equal(nextMenuIndex(0, "End", 4), 3);
  assert.equal(nextMenuIndex(1, "Enter", 4), null);
  assert.equal(nextMenuIndex(1, "a", 4), null);
});

test("nextMenuIndex tolerates an out-of-range or empty current index / count", () => {
  assert.equal(nextMenuIndex(-1, "ArrowDown", 3), 1); // treat as index 0
  assert.equal(nextMenuIndex(99, "ArrowDown", 3), 1);
  assert.equal(nextMenuIndex(0, "ArrowDown", 0), null); // no options
});
