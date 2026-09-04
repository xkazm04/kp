// match-card-shows-the-unproven-middle (c). `cellClass` is the function every one of
// the grid's up-to-200×N cells calls to decide its colour, and it had no test: the
// band walk is a "last band whose floor the score clears" loop, which is exactly the
// shape that silently goes off-by-one when MATRIX_BANDS is re-banded. These assertions
// are derived from MATRIX_BANDS rather than hardcoding class strings, so re-banding
// updates the expectation with the table instead of breaking a snapshot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCKED_CELL, cellClass } from "./matrixCellClass.ts";
import { MATRIX_BANDS, STRONG_THRESHOLD } from "./matrixStats.ts";

test("a blocked cell, and an unassessed one, both paint the hatched BLOCKED_CELL", () => {
  assert.equal(cellClass({ score: null, blocked: true }), BLOCKED_CELL);
  // The load-bearing half: NOT blocked but never scored is still not a 0-score cell —
  // painting it coral would claim a poor fit the pipeline never computed.
  assert.equal(cellClass({ score: null, blocked: false }), BLOCKED_CELL);
  assert.equal(cellClass({ score: 91, blocked: true }), BLOCKED_CELL, "blocked wins over a score");
});

test("every band's inclusive floor picks that band, and one below picks the one under it", () => {
  for (let i = 0; i < MATRIX_BANDS.length; i++) {
    const band = MATRIX_BANDS[i];
    assert.equal(cellClass({ score: band.min, blocked: false }), band.cellClass, `floor ${band.min} → ${band.label}`);
    if (i > 0) {
      assert.equal(
        cellClass({ score: band.min - 1, blocked: false }),
        MATRIX_BANDS[i - 1].cellClass,
        `${band.min - 1} must stay in ${MATRIX_BANDS[i - 1].label}, not reach ${band.label}`,
      );
    }
  }
});

test("a genuine 0 is the lowest band (never the blocked hatch) and 100 is the top band", () => {
  assert.equal(cellClass({ score: 0, blocked: false }), MATRIX_BANDS[0].cellClass);
  assert.equal(cellClass({ score: 100, blocked: false }), MATRIX_BANDS[MATRIX_BANDS.length - 1].cellClass);
});

test("the strong threshold the row-star and min-fit floor use is a real band floor", () => {
  // rowStrong (MatrixGrid) and MIN_FIT_FLOORS both count from STRONG_THRESHOLD; if it
  // ever drifted off a band edge the grid would star cells the heatmap paints non-strong.
  assert.ok(MATRIX_BANDS.some((b) => b.min === STRONG_THRESHOLD), "STRONG_THRESHOLD must be a band floor");
  assert.notEqual(cellClass({ score: STRONG_THRESHOLD, blocked: false }), cellClass({ score: STRONG_THRESHOLD - 1, blocked: false }));
});
