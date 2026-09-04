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

test("every piece of menu microcopy falls back to the catalog, not to English", () => {
  // The four props (placeholder, clearLabel, searchPlaceholder, noMatchesLabel) used to
  // carry ENGLISH DEFAULTS in the destructure. `searchPlaceholder` and `noMatchesLabel`
  // had zero overriding callers and `placeholder` had none of the 50 either, so cs/de/fr
  // read "Search…" / "No matches" / "Select…" on every searchable select in the product.
  // A default is not a caller's problem to localize — it is the component's.
  for (const [prop, key] of [
    ["placeholder", "placeholder"],
    ["clearLabel", "clear"],
    ["searchPlaceholder", "searchPlaceholder"],
    ["noMatchesLabel", "noMatches"],
  ]) {
    assert.match(
      src,
      new RegExp(`${prop} \\?\\? t\\("${key}"\\)`),
      `${prop} must fall back to select.${key}, not to an English literal`
    );
  }
  // …and no prop may reintroduce one. `scripts/i18n/primitive-copy-defaults.mjs` is the
  // repo-wide gate; this is the local statement of the same rule.
  assert.doesNotMatch(src, /^\s{2}\w+ = "[A-Z]/m, "no prop default may be English copy");
});

test("there is ONE size vocabulary: sizeVariant", () => {
  // `size` was a back-compat alias for the same two values, and all 34 call sites that
  // set a size had taken it (zero used `sizeVariant`) — so the primitive that owns the
  // app's field sizing was the one disagreeing with TextInput and TextArea about what
  // the prop is called. The alias is gone; `size` on a Select is now a tsc error rather
  // than a prop that quietly does the same thing under two names.
  assert.doesNotMatch(src, /\n\s*size\?: "sm" \| "md";/, "the size alias must not come back");
  assert.match(src, /sizeVariant = "md",/, "sizeVariant carries the default");
  assert.match(src, /const sizeCls = sizeVariant === "sm"/);
});

test("the typeahead timer is cleared on unmount", () => {
  // A 600ms buffer-reset timer opened by the last keystroke before a tab switch or a
  // modal close outlived the component — one live timer per Select on a page full of them.
  assert.match(src, /if \(typeahead\.current\.timer\) window\.clearTimeout\(typeahead\.current\.timer\);/);
});

test("commit refuses a disabled row, and the row announces that it is disabled", () => {
  // Load-bearing honesty claim: a disabled option (e.g. a JD output language the
  // configured model cannot produce) must not be silently selectable.
  assert.match(src, /const commit = \(row: MenuRow \| undefined\) => \{\s*\n\s*if \(!row \|\| row\.disabled\) return;/);
  // …and since Home/End and the open-menu preselect can park the active pointer on a
  // disabled row, the option itself must say so — otherwise the no-op reads as a hang.
  assert.match(src, /role="option"[^>]*aria-disabled=\{row\.disabled \|\| undefined\}/);
});
