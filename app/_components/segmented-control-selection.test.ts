// Pins the SegmentedControl unmatched-value contract: a `value` that matches no
// option is a developer error that resolves to "nothing selected" (every radio
// aria-checked=false, pill hidden) while keeping the group keyboard-reachable.
// Testing the pure resolver — the component itself can't load under `node --test`
// (path-alias + framer-motion + hooks need a bundler/DOM).
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSegmentedSelection } from "./segmented-control-selection.ts";

const OPTIONS: { value: string }[] = [{ value: "a" }, { value: "b" }, { value: "c" }];

test("selects the matching option (single selection, that index is the tab stop)", () => {
  const r = resolveSegmentedSelection(OPTIONS, "b");
  assert.equal(r.selectedIndex, 1);
  assert.equal(r.focusIndex, 1);
  assert.equal(r.hasSelection, true);
});

test("the first option matches at index 0", () => {
  const r = resolveSegmentedSelection(OPTIONS, "a");
  assert.equal(r.selectedIndex, 0);
  assert.equal(r.hasSelection, true);
});

test("value matching no option: announces nothing selected, stays reachable", () => {
  const r = resolveSegmentedSelection(OPTIONS, "nope");
  // hasSelection=false → every radio renders aria-checked=false and the ink pill
  // is hidden. This is the INTENTIONAL announced state for the dev-error case.
  assert.equal(r.selectedIndex, -1);
  assert.equal(r.hasSelection, false);
  // First option remains the sole tab stop so the group is still keyboard-reachable.
  assert.equal(r.focusIndex, 0);
});

test("empty options: no selection, focusIndex defaults to 0", () => {
  const r = resolveSegmentedSelection([], "anything");
  assert.equal(r.selectedIndex, -1);
  assert.equal(r.hasSelection, false);
  assert.equal(r.focusIndex, 0);
});
