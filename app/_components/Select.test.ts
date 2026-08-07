import { test } from "node:test";
import assert from "node:assert/strict";
import { selectConsumesKeyWhileOpen } from "./select-keys.ts";

// bug-ui-scan 2026-07-09 (shared-ui-design-system #1): an open Select inside a
// useDialogA11y dialog called preventDefault() but never stopPropagation() on Escape,
// so one Escape closed BOTH the dropdown and the parent dialog. The handler now stops
// propagation for exactly the keys that alter dialog state, and only while open.

test("Escape and Enter are consumed (stop propagation) while the dropdown is open", () => {
  assert.equal(selectConsumesKeyWhileOpen("Escape"), true);
  assert.equal(selectConsumesKeyWhileOpen("Enter"), true);
});

test("navigation keys are NOT consumed — they're harmless to let bubble", () => {
  for (const k of ["ArrowDown", "ArrowUp", "Home", "End", "Tab", "a", " "]) {
    assert.equal(selectConsumesKeyWhileOpen(k), false, `${k} must not stop propagation`);
  }
});
