// Pins the board header's SOURCE facet contract.
//
// The bug: State / Score / Sort all parse their URL params against a closed
// vocabulary, so a selected value is always one of the menu's options. A SOURCE is
// an open-ended channel id — `parseSourcesParam` accepts any token by design — and
// the option list was built from `sourceValues`, which is derived from the entries
// on the board. A shared `?source=<channel>` link (or a saved view minted while that
// channel still had candidates) therefore selected a value the menu could not offer:
// the facet emptying the board rendered as "off", and when the board was left
// spanning one channel the menu was not rendered at all, so the filter could only be
// cleared by wiping every other facet with it.
//
// Non-vacuity: against pre-fix code both assertions FAIL (the options came from
// `sourceValues.map(` and the gate was exactly `sourceValues.length > 1 ?`).
//
// The bar is a .tsx with no component-test runner in this repo, so the contract is
// pinned by reading the source — the same technique pipelineMoveTargets.test.ts uses
// to keep PipelineBulkActionBar routed through its helper.
//
// Runner: Node's built-in test runner (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bar = readFileSync(new URL("./PipelineFilterBar.tsx", import.meta.url), "utf8");

test("the source menu's options are the board's channels UNION the active selection", () => {
  assert.match(
    bar,
    /const sourceOptions = \[\.\.\.new Set\(\[\.\.\.sourceValues, \.\.\.sources\]\)\]/,
    "sourceOptions must union the entries-derived values with the current selection"
  );
  assert.match(
    bar,
    /options=\{sourceOptions\.map\(/,
    "the Source <PipelineFilterMenu> must render sourceOptions, not the raw sourceValues"
  );
  assert.ok(
    !/options=\{sourceValues\.map\(/.test(bar),
    "an off-board selected source must still be an offered (and uncheckable) row"
  );
});

test("an active source filter keeps its menu on screen however few channels remain", () => {
  // The single-source suppression stays — a board that spans one channel offers no
  // menu — but it must not swallow a filter that is already narrowing the board.
  assert.match(
    bar,
    /\{sourceOptions\.length > 1 \|\| sources\.size > 0 \? \(/,
    "the Source facet must render whenever a source is selected, not only when the board spans >1 channel"
  );
});
