// bug-ui-scan-2026-07-09 (analysis-result-panels #3): lock the score→band mapping
// that drives the (now localized) dial verdict word + aria-label, so the extraction
// that enabled i18n can't silently shift a boundary.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { VERDICT_BANDS, scoreBandIndex } from "./scoreDial.logic.ts";

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
  assert.equal(VERDICT_BANDS.length, 5);
  for (const band of VERDICT_BANDS) {
    assert.match(band.key, /^scoreBands\.[a-z]+$/);
  }
});

// The agreement test the duplicated cutoffs never had. `scoreBandIndex` used to
// be a hand-written if-ladder repeating the `to:` values in VERDICT_BANDS four
// lines above it, so the dial's arc segments and the verdict WORD could drift
// apart silently. Derive-and-verify: the function must be a pure function of the
// table across the whole 0..100 domain, plus the out-of-domain inputs callers
// actually produce.
test("scoreBandIndex agrees with the VERDICT_BANDS table at every score", () => {
  const fromTable = (score: number) => {
    const i = VERDICT_BANDS.findIndex((b) => score <= b.to);
    return i === -1 ? VERDICT_BANDS.length - 1 : i;
  };
  for (let score = 0; score <= 100; score += 1) {
    const idx = scoreBandIndex(score);
    assert.equal(idx, fromTable(score), `score ${score}`);
    const band = VERDICT_BANDS[idx];
    assert.ok(score <= band.to, `score ${score} landed above its band's upper bound`);
    assert.ok(score >= band.from || idx === 0, `score ${score} landed below its band's lower bound`);
  }
});

test("the bands tile 0..100 with no gap and no overlap", () => {
  assert.equal(VERDICT_BANDS[0].from, 0);
  assert.equal(VERDICT_BANDS[VERDICT_BANDS.length - 1].to, 100);
  for (let i = 1; i < VERDICT_BANDS.length; i += 1) {
    assert.equal(VERDICT_BANDS[i].from, VERDICT_BANDS[i - 1].to, `band ${i} must start where band ${i - 1} ends`);
  }
});

test("an out-of-range or non-finite score lands in a real band, never undefined", () => {
  // ScoreDial clamps and VerdictBanner guards, but the ladder this replaced also
  // answered these — keep answering them the same way rather than returning -1.
  for (const score of [-10, 0, 100, 250, NaN, Infinity, -Infinity]) {
    const idx = scoreBandIndex(score);
    assert.ok(VERDICT_BANDS[idx] !== undefined, `score ${score} produced index ${idx}`);
  }
  assert.equal(scoreBandIndex(-10), 0);
  assert.equal(scoreBandIndex(250), VERDICT_BANDS.length - 1);
  assert.equal(scoreBandIndex(NaN), VERDICT_BANDS.length - 1, "NaN reads as the top band, as it always did");
});
