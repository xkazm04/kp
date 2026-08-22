import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { selectConsumesKeyWhileOpen } from "./select-keys.ts";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "Select.tsx"), "utf8");

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

// ── Source guards over Select.tsx (JSX has no runner here, so pin the structure) ──

test("the active option is exposed via aria-activedescendant on the focused element", () => {
  // Focus stays on the trigger (or the filter box); the "active" row moves by state.
  // aria-activedescendant is therefore the ONLY channel that tells a screen-reader
  // user which option Arrow/Home/End/typeahead selected and which one Enter commits.
  // It was named in the module's APG claim but never rendered — the row highlighted
  // visually and nothing was announced.
  assert.match(src, /const optionId = \(idx: number\) =>/, "each option needs a stable id to point at");
  assert.match(src, /<li key=\{`\$\{row\.value\}-\$\{idx\}`\} id=\{optionId\(idx\)\}/, "the option <li> must carry that id");
  // Both focus holders carry the pointer: the role=combobox trigger and the filter box.
  assert.equal(
    (src.match(/aria-activedescendant=\{activeDescendant\}/g) ?? []).length,
    2,
    "trigger AND filter input must both expose aria-activedescendant"
  );
  // The id must resolve: no dangling reference when the list is empty ("No matches")
  // or the index is stale after a filter narrowed the rows.
  assert.match(src, /open && active >= 0 && active < rows\.length \? optionId\(active\) : undefined/);
});

test("commit refuses a disabled row, and the row announces that it is disabled", () => {
  // Load-bearing honesty claim: a disabled option (e.g. a JD output language the
  // configured model cannot produce) must not be silently selectable.
  assert.match(src, /const commit = \(row: MenuRow \| undefined\) => \{\s*\n\s*if \(!row \|\| row\.disabled\) return;/);
  // …and since Home/End and the open-menu preselect can park the active pointer on a
  // disabled row, the option itself must say so — otherwise the no-op reads as a hang.
  assert.match(src, /role="option"[^>]*aria-disabled=\{row\.disabled \|\| undefined\}/);
});
