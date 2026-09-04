import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The table folder holds a SECOND anchored-menu family beside `Select` — ColumnFilter,
// SearchSelect and their shared OptionList. Select is a full APG listbox (role=combobox
// trigger, role=listbox, role=option, aria-activedescendant, arrow/Home/End/Enter);
// these three had NO `role=` attribute at all, so the same interaction on the same
// product surface was a list of buttons in a div to a screen reader, and unreachable by
// keyboard past Tab.
//
// They do NOT compose Select: ColumnFilter's trigger is the column HEADER itself (or a
// glyph beside a sort control) and its `mode="search"` variant opens a free-text box
// with no option list at all — neither is a select. So they adopt the ROLES instead,
// mirroring Select's shape exactly, and these guards pin that they keep them. JSX has no
// runner here, so the structure is pinned at the source level, as `Select.test.ts` does.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const columnFilter = readFileSync(path.join(HERE, "ColumnFilter.tsx"), "utf8");
const filterMenu = readFileSync(path.join(HERE, "FilterMenu.tsx"), "utf8");

test("the option list is a listbox whose rows are options", () => {
  assert.match(filterMenu, /<ul[^>]*\brole="listbox"/, "the <ul> must be the listbox");
  assert.match(filterMenu, /role="option" aria-selected=/, "each row must be an option that says whether it is chosen");
  assert.match(filterMenu, /const optionId = \(idx: number\) =>/, "options need stable ids for aria-activedescendant");
  // Both the clear row and the filtered options come from ONE array, so the active index
  // addresses the list a reader actually sees (the clear row used to sit outside it).
  assert.match(filterMenu, /const rows: Option\[\] = clearLabel \?/);
});

test("the focused element carries aria-activedescendant, and the id always resolves", () => {
  // Focus stays in the filter box (it autofocuses on open); the active row moves by
  // state. aria-activedescendant is the only channel that announces which row Arrow/
  // Home/End landed on and which one Enter will pick.
  assert.match(filterMenu, /aria-activedescendant=\{activeDescendant\}/);
  assert.match(filterMenu, /active >= 0 && active < rows\.length \? optionId\(active\) : undefined/);
});

test("the list is navigable from the keyboard", () => {
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter"]) {
    assert.match(filterMenu, new RegExp(`case "${key}":`), `${key} must move or commit the active row`);
  }
});

test("a trigger that opens an option list is a combobox pointing at it", () => {
  // ColumnFilter mode="select" (both trigger shapes) and SearchSelect. NOT the
  // mode="search" free-text trigger: there is no listbox behind it, and a combobox
  // whose aria-controls resolves to nothing is worse than a plain button.
  assert.equal((columnFilter.match(/role=\{isListbox \? "combobox" : undefined\}/g) ?? []).length, 2);
  assert.match(columnFilter, /aria-haspopup=\{isListbox \? "listbox" : undefined\}/);
  assert.match(columnFilter, /role="combobox"[\s\S]{0,400}aria-haspopup="listbox"/, "SearchSelect's trigger is unconditionally a combobox");
  // The listbox id is minted by the trigger and handed to the menu, so aria-controls
  // and the <ul> can never drift apart.
  assert.equal((columnFilter.match(/listId=\{listId\}/g) ?? []).length, 2);
  assert.match(columnFilter, /const listId = useId\(\);/);
});

test("aria-expanded is on every trigger, including the free-text one", () => {
  assert.equal((columnFilter.match(/aria-expanded=\{Boolean\(anchor\)\}/g) ?? []).length, 3);
});
