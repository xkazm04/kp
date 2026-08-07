import { test } from "node:test";
import assert from "node:assert/strict";
import { paletteItemId, paletteListView } from "./workspacePaletteResults.ts";

// bug-ui-scan 2026-07-09 (app-shell-navigation #3, #4).

// #3: single source for the option id, shared by the rendered id, the input's
// aria-activedescendant, and the new scroll-into-view lookup.
test("paletteItemId is the stable per-index option id", () => {
  assert.equal(paletteItemId(0), "palette-item-0");
  assert.equal(paletteItemId(7), "palette-item-7");
});

// #4: while a newer query is in flight over a prior query's hits, show the Searching
// affordance AND dim the lingering rows (don't present them as final).
test("searching over stale results: Searching affordance + dim the lingering rows", () => {
  const v = paletteListView({ loading: true, queryLen: 4, itemCount: 6, hasError: false });
  assert.equal(v.showSearching, true);
  assert.equal(v.dimItems, true);
  assert.equal(v.placeholder, null);
});

test("searching with no items yet: Searching affordance only, nothing to dim, no placeholder", () => {
  const v = paletteListView({ loading: true, queryLen: 4, itemCount: 0, hasError: false });
  assert.deepEqual(v, { showSearching: true, dimItems: false, placeholder: null });
});

// The core bug: during the debounce the palette must NOT flash "no matches" for the
// term the user just changed, nor claim results are final.
test("a >= 2-char query still loading never flashes the 'no matches' placeholder", () => {
  const v = paletteListView({ loading: true, queryLen: 4, itemCount: 0, hasError: false });
  assert.notEqual(v.placeholder, "no-results");
  assert.equal(v.showSearching, true);
});

test("settled search with zero matches shows no-results — but not while an error is up", () => {
  assert.equal(paletteListView({ loading: false, queryLen: 4, itemCount: 0, hasError: false }).placeholder, "no-results");
  assert.equal(paletteListView({ loading: false, queryLen: 4, itemCount: 0, hasError: true }).placeholder, "empty");
});

test("at rest (empty query): no Searching, no dim; empty hint only when there are no items", () => {
  assert.deepEqual(
    paletteListView({ loading: false, queryLen: 0, itemCount: 3, hasError: false }),
    { showSearching: false, dimItems: false, placeholder: null }
  );
  assert.deepEqual(
    paletteListView({ loading: false, queryLen: 0, itemCount: 0, hasError: false }),
    { showSearching: false, dimItems: false, placeholder: "empty" }
  );
});
