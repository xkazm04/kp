// The inline toolbar's fold (kit.css, Gate 3): with a search on the line, the filters end where the
// search starts, and on a folded sheet they move to their own line under it. Two grid areas that
// share a track are how chips came to sit under the search field; this pins that they cannot.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./kit.css", import.meta.url), "utf8");
const RULE = ".k-toolbar--inline:has(> .k-toolbar__search) > .k-toolbar__filters";

test("inline with a search: the filters stop at the search's first track", () => {
  const search = /\.k-toolbar__search \{ grid-column: (\w+) \/ (\w+); grid-row: 1; \}/.exec(css);
  assert.ok(search, "the search's base placement is still fig / act on line one");
  const wide = css.indexOf(`${RULE} { grid-column: meta / ${search[1]}; }`);
  assert.ok(wide > 0, "the filters end on the search's start line");
});

test("on a folded sheet the filters take their own line under the search", () => {
  const block = css.lastIndexOf("@container sheet (max-width: 1000px)");
  const folded = css.slice(block, css.indexOf("\n}", block));
  assert.match(folded, /\.k-toolbar--inline:has\(> \.k-toolbar__search\) > \.k-toolbar__filters \{ grid-column: mark \/ end; grid-row: 2; \}/);
  assert.ok(block > css.indexOf(`${RULE} { grid-column: meta`), "the fold comes after the wide rule, so it wins");
});

test("at 860px, where the search takes line two, the filters take line three", () => {
  assert.match(css, /\.k-toolbar__search \{ grid-column: mark \/ end; grid-row: 2; \}/, "the kit's 860px step moves the search to line two");
  const block = css.lastIndexOf("@container sheet (max-width: 860px)");
  assert.ok(block > css.lastIndexOf("@container sheet (max-width: 1000px)"), "the 860px step comes last, so it wins");
  assert.match(css.slice(block), /\.k-toolbar--inline:has\(> \.k-toolbar__search\) > \.k-toolbar__filters \{ grid-row: 3; \}/);
});
