// The Market Pulse formatters — the seam every figure on the public /market page
// passes through.
//
// What is pinned here, and why:
//   1. A money figure NAMES ITS CURRENCY in every locale. The compact formatter
//      used to print the Czech abbreviation "28,6 tis." with a hard-coded comma
//      decimal and no currency at all, to a German, French and English audience;
//      that string is on the map legend, the region ranges, every salary band
//      and every job-ad range.
//   2. `cs` output is unchanged from the hand-rolled formatters it replaced —
//      regionLabel.test.ts compares whole strings against them.
//   3. Non-figures (null, NaN, ±Infinity) print an em dash, never "NaN Kč".
//      The scale maths upstream really does produce Infinity (`Math.min()` of an
//      empty array), which is how "Infinity" once reached the legend.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARKET_LOCALE,
  STALE_AFTER_DAYS,
  fmtCompact,
  fmtCzk,
  fmtCzkShort,
  fmtDate,
  fmtInt,
  isFigure,
  snapshotAgeDays,
} from "./data.ts";

const LOCALES = ["en", "cs", "de", "fr"] as const;
// The non-breaking space Intl uses as the Czech group separator (U+00A0).
const NB = " ";

test("isFigure accepts only printable numbers", () => {
  for (const ok of [0, -1, 28_600, 1e6]) assert.equal(isFigure(ok), true, `${ok} is a figure`);
  for (const no of [null, undefined, NaN, Infinity, -Infinity]) assert.equal(isFigure(no), false, `${String(no)}`);
});

test("every formatter degrades to an em dash rather than printing NaN or Infinity", () => {
  for (const bad of [null, undefined, NaN, Infinity, -Infinity]) {
    for (const [name, fn] of [
      ["fmtInt", fmtInt],
      ["fmtCzk", fmtCzk],
      ["fmtCzkShort", fmtCzkShort],
      ["fmtCompact", fmtCompact],
    ] as const) {
      for (const locale of LOCALES) {
        assert.equal(fn(bad as number | null, locale), "—", `${name}(${String(bad)}, ${locale})`);
      }
    }
  }
  assert.equal(fmtDate(null), "—");
  assert.equal(fmtDate(undefined), "—");
});

test("compact money names the currency in EVERY locale, not just Czech", () => {
  // The regression this file exists for: "28,6 tis." carried no currency and was
  // shown, verbatim, to en / de / fr readers.
  for (const locale of LOCALES) {
    const out = fmtCzkShort(28_600, locale);
    assert.match(out, /CZK|Kč/, `fmtCzkShort(28600, ${locale}) = "${out}" names no currency`);
    assert.match(out, /\d/, `fmtCzkShort(28600, ${locale}) = "${out}" lost its digits`);
  }
});

test("full money figures name the currency in every locale too", () => {
  for (const locale of LOCALES) {
    const out = fmtCzk(81_800, locale);
    assert.match(out, /CZK|Kč/, `fmtCzk(81800, ${locale}) = "${out}"`);
    assert.doesNotMatch(out, /[.,]00/, `fmtCzk should not print minor units: "${out}"`);
  }
});

test("a locale Intl refuses degrades to Czech formatting instead of throwing", () => {
  // A RangeError here would take the whole client-rendered page down.
  assert.equal(fmtCzk(81_800, "not-a-locale!"), fmtCzk(81_800, MARKET_LOCALE));
  assert.equal(fmtDate("2026-07-03", "not-a-locale!"), fmtDate("2026-07-03", MARKET_LOCALE));
});

test("Czech output is byte-identical to the hand-rolled formatters it replaced", () => {
  // regionLabel.test.ts compares whole accessible-name strings built from these.
  assert.equal(fmtInt(38_553), `38${NB}553`);
  assert.equal(fmtCzk(81_800), `81${NB}800${NB}Kč`);
  assert.equal(fmtDate("2026-07-03"), "3. 7. 2026");
});

test("a malformed ISO date is returned as given rather than guessed at", () => {
  assert.equal(fmtDate("not-a-date"), "not-a-date");
  assert.equal(fmtDate("2026-07"), "2026-07");
});

test("the date is formatted in UTC, so it never slips a day by timezone", () => {
  // The snapshot's dates are calendar days, not instants: parsing them as local
  // time renders "2. 7." west of Greenwich.
  assert.match(fmtDate("2026-07-03", "en"), /7\/3\/2026/);
});

test("fmtCompact carries the survey headcount without a currency", () => {
  for (const locale of LOCALES) {
    const out = fmtCompact(117_000, locale);
    assert.match(out, /\d/, `${locale}: "${out}"`);
    assert.doesNotMatch(out, /CZK|Kč/, `${locale}: a headcount is not money — "${out}"`);
  }
});

test("snapshotAgeDays measures the committed snapshot against now", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");
  assert.equal(snapshotAgeDays("2026-09-04", now), 0);
  assert.equal(snapshotAgeDays("2026-07-03", now), 63);
  // Past the freshness bar the page is required to say so out loud.
  assert.ok(snapshotAgeDays("2026-07-03", now)! > STALE_AFTER_DAYS);
  assert.equal(snapshotAgeDays(null, now), null);
  assert.equal(snapshotAgeDays("nonsense", now), null);
  // A snapshot dated in the future is a clock skew, not a negative age.
  assert.equal(snapshotAgeDays("2026-12-01", now), 0);
});
