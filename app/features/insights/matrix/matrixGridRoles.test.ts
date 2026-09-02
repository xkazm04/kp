// match-card-shows-the-unproven-middle (a) + (b). A source guard: both behaviours live
// in JSX with no pure seam to call, and what has to stay true is structural.
//
// (b) The grid declared role="grid" and a roving tabindex, so arrows moved focus around
// a rectangle — but the cells were bare <td>s with no indices, so a screen reader could
// announce the cell's own label and nothing about WHERE it is. "row 14 of 63, column 3
// of 9" is the entire point of a grid over a list, and it needs four things together:
// gridcell roles, 1-based row/col indices, and counts for them to be "of".
//
// (a) The claimed-but-unproven bucket on the match card. Pinned here rather than by a
// snapshot: what matters is that the payload fields reach the chip row, that the labels
// come from the decisions.summary catalog (shared vocabulary, four locales already) and
// that the reason code degrades to the neutral "claimed" label.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const grid = readFileSync(new URL("./MatrixGrid.tsx", import.meta.url), "utf8");
const chips = readFileSync(new URL("./focus/MatchCardSkillChips.tsx", import.meta.url), "utf8");
const card = readFileSync(new URL("./focus/MatchCard.tsx", import.meta.url), "utf8");

test("every scored cell is a gridcell, not an anonymous <td>", () => {
  assert.match(grid, /<td key=\{p\.id\} role="gridcell"/, "the cell element must carry role=gridcell");
});

test("cells and headers carry 1-based row/column indices, and the table declares the counts", () => {
  assert.match(grid, /aria-rowcount=\{rows\.length \+ 1\}/, "data rows plus the header row");
  assert.match(grid, /aria-colcount=\{cols\.length \+ 1\}/, "position columns plus the candidate column");
  assert.match(grid, /<tr aria-rowindex=\{1\}>/, "the header row is row 1");
  assert.match(grid, /<tr key=\{cand\.id\} aria-rowindex=\{r \+ 2\}/, "data row r is row r+2");
  // The candidate column is column 1, so every position column is offset by two.
  assert.equal((grid.match(/aria-colindex=\{ci \+ 2\}/g) ?? []).length, 2, "the column header AND the cell");
  assert.equal((grid.match(/aria-colindex=\{1\}/g) ?? []).length, 2, "the corner header AND the row header");
});

test("the sticky header cells are named as headers, not generic cells", () => {
  assert.match(grid, /scope="col" role="columnheader" aria-colindex=\{1\}/, "the corner");
  assert.match(grid, /scope="row" role="rowheader" aria-colindex=\{1\}/, "the candidate name cell");
});

test("the match card passes the unproven bucket through to the chip row", () => {
  for (const prop of ["unprovenSkills", "unprovenSkillStrength", "unprovenSkillReason"]) {
    assert.ok(card.includes(`${prop}={m.${prop}}`), `MatchCard must forward ${prop}`);
    assert.ok(chips.includes(`${prop}?:`), `MatchCardSkillChips must accept ${prop}`);
  }
});

test("the unproven chips reuse the decisions.summary vocabulary, in the reader's locale", () => {
  assert.match(chips, /useTranslations\("decisions\.summary"\)/, "no forked copy of the six strings");
  for (const key of ["unprovenTitle", "unprovenHelp", "unprovenStrengthTitle"]) {
    assert.ok(chips.includes(`tu("${key}"`), `${key} must be rendered`);
  }
  // No raw string may reach the chip — every label goes through the catalog.
  assert.match(chips, /tu\(unprovenLabelKey\(/, "the reason badge is a catalog lookup");
});

test("an unknown or absent reason code degrades to the neutral 'claimed' label", () => {
  assert.match(
    chips,
    /: "unprovenClaimed";/,
    "the mapper's final fallback must be unprovenClaimed — never one of the specific claims",
  );
});
