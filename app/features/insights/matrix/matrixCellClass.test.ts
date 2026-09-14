// match-card-shows-the-unproven-middle (c). `cellClass` is the function every one of
// the grid's up-to-200×N cells calls to decide its colour, and it had no test: the
// band walk is a "last band whose floor the score clears" loop, which is exactly the
// shape that silently goes off-by-one when MATRIX_BANDS is re-banded. These assertions
// are derived from MATRIX_BANDS rather than hardcoding class strings, so re-banding
// updates the expectation with the table instead of breaking a snapshot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { announcedCellScore, BLOCKED_CELL, cellClass } from "./matrixCellClass.ts";
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

// lens-sweep round 2 (ui-perfectionist / a11y, context matrix-ui-2). The paint above
// treats "never scored" as unassessed, and the cell body renders nothing for it
// (`{c.blocked ? "–" : c.score}` with a null score). The ACCESSIBLE NAME did not agree:
// `t("matchVal", { score: c.score ?? 0 })` announced a concrete "match 0" for the very
// cell the grid paints and reads as not-assessed, and the `title` did the same with a
// bare `c.score ?? 0`. A screen-reader user was therefore told the one thing the test
// above says the colour must never claim — a poor fit the pipeline never computed.
//
// `announcedCellScore` is the single predicate both halves share, so the name and the
// paint cannot disagree again.
test("what a cell ANNOUNCES agrees with what it PAINTS — no score is never announced as 0", () => {
  assert.equal(announcedCellScore({ score: null, blocked: false }), null, "unassessed announces no number");
  assert.equal(announcedCellScore({ score: null, blocked: true }), null);
  assert.equal(announcedCellScore({ score: 91, blocked: true }), null, "blocked wins over a score, as in the paint");
  assert.equal(announcedCellScore({ score: 0, blocked: false }), 0, "a GENUINE 0 is still announced as 0");
  assert.equal(announcedCellScore({ score: 74, blocked: false }), 74);
});

test("the two agree by construction, across every band floor and both null cases", () => {
  const cases = [
    { score: null, blocked: false },
    { score: null, blocked: true },
    { score: 0, blocked: false },
    { score: 100, blocked: false },
    { score: 50, blocked: true },
    ...MATRIX_BANDS.map((b) => ({ score: b.min, blocked: false })),
  ];
  for (const c of cases) {
    assert.equal(
      cellClass(c) === BLOCKED_CELL,
      announcedCellScore(c) === null,
      `paint and accessible name must agree for ${JSON.stringify(c)}`,
    );
  }
});

test("the grid row builds its title and accessible name from that predicate", () => {
  // Not drivable without a React renderer, which this runner does not have; the two
  // strings are pinned at the source in the idiom app/api/rate-limit-contract.test.ts
  // established here.
  const src = readFileSync(fileURLToPath(new URL("./MatrixGridRow.tsx", import.meta.url)), "utf8");
  assert.match(src, /announcedCellScore\(/, "the row must use the shared predicate");
  assert.doesNotMatch(
    src,
    /c\.score \?\? 0/,
    "`c.score ?? 0` is the defect itself — it turns 'not assessed' into a concrete 0",
  );
});
