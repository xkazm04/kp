// bug-ui-scan-2026-07-09 (analysis-result-panels #3): lock the score→band mapping
// that drives the (now localized) dial verdict word + aria-label, so the extraction
// that enabled i18n can't silently shift a boundary.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { SCORE_BANDS, scoreBandIndex } from "./scoreDial.logic.ts";

test("band boundaries are upper-bound inclusive (40→Early, 55→Developing, ...)", () => {
  assert.equal(scoreBandIndex(0), 0);
  assert.equal(scoreBandIndex(40), 0); // Early
  assert.equal(scoreBandIndex(41), 1); // Developing
  assert.equal(scoreBandIndex(55), 1);
  assert.equal(scoreBandIndex(56), 2); // Solid
  assert.equal(scoreBandIndex(70), 2);
  assert.equal(scoreBandIndex(72), 3); // Strong
  assert.equal(scoreBandIndex(85), 3);
  assert.equal(scoreBandIndex(100), 4); // Excellent
});

test("every band exposes a report.scoreBands.* translation key", () => {
  assert.equal(SCORE_BANDS.length, 5);
  for (const band of SCORE_BANDS) {
    assert.match(band.key, /^scoreBands\.[a-z]+$/);
  }
});
