// Locks the CzMap region accessible-name contract (landing-marketing finding #1):
// the choropleth encodes each region's metric purely as heat-ramp fill, so a
// keyboard / screen-reader visitor who focuses a region path must hear its VALUE
// (open-vacancy count + median pay) — not just the region name — folded into the
// accessible name. `regionAriaLabel` is the pure decision behind that; these
// tests pin that the value travels with the label, in the localised words the
// caller passes, formatted for the reader's locale, and that a missing median
// degrades to a phrase instead of "—".
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { regionAriaLabel, type RegionLabelText } from "./regionLabel.ts";
import type { Region } from "./data.ts";

// Intl puts a non-breaking space (U+00A0) between the currency and the amount
// (and cs also groups thousands with it), not an ASCII space — this const holds
// that exact codepoint so the full-string expectations below compare against
// what the formatter produces.
const NB = " ";

// English label words, as CzMap supplies them from the `jobMarket.map` catalog.
const EN: RegionLabelText = {
  vacancies: "open vacancies",
  median: "median salary",
  medianUnavailable: "median salary not available",
};

function region(over: Partial<Region> = {}): Region {
  return {
    krajId: "1",
    code: "CZ010",
    name: "Hlavní město Praha",
    vacancies: 7163,
    medianSalary: 24100,
    p25: null,
    p75: null,
    ...over,
  };
}

test("folds BOTH figures — the vacancy count and the median — into the name", () => {
  const label = regionAriaLabel(region(), EN, "en");
  // The whole point of the fix: the value a sighted user reads off the card must
  // be present in the accessible name a screen reader announces on focus.
  assert.match(label, /7,163 open vacancies/);
  assert.match(label, /median salary CZK\s24,100/);
  assert.equal(label, `Hlavní město Praha: 7,163 open vacancies, median salary CZK${NB}24,100`);
});

test("leads with the region name so AT announces which region the value belongs to", () => {
  assert.match(regionAriaLabel(region({ name: "Středočeský kraj" }), EN, "en"), /^Středočeský kraj:/);
});

test("uses the caller-supplied localised words (nothing English is hardcoded)", () => {
  const CS: RegionLabelText = {
    vacancies: "volných míst",
    median: "medián mzdy",
    medianUnavailable: "medián mzdy není k dispozici",
  };
  const label = regionAriaLabel(region(), CS, "cs");
  assert.equal(label, `Hlavní město Praha: 7${NB}163 volných míst, medián mzdy 24${NB}100${NB}Kč`);
  assert.doesNotMatch(label, /open vacancies|median salary/);
});

test("the koruna is Kč in Czech only and CZK for every other reader (operator ruling 2026-09-14)", () => {
  // The label used to format with the module's cs default whatever the page
  // language, so an English, German or French screen reader heard "Kč" while the
  // sighted card beside it read CZK.
  for (const locale of ["en", "de", "fr"]) {
    const label = regionAriaLabel(region(), EN, locale);
    assert.match(label, /\bCZK\b/, `${locale}: "${label}"`);
    assert.doesNotMatch(label, /Kč/, `${locale}: "${label}"`);
  }
  assert.match(regionAriaLabel(region(), EN, "cs"), /Kč$/);
});

test("degrades to the 'unavailable' phrase when a region has no median (never a bare —)", () => {
  const label = regionAriaLabel(region({ medianSalary: null }), EN, "en");
  assert.match(label, /7,163 open vacancies, median salary not available/);
  assert.doesNotMatch(label, /—/);
});

test("still announces the count when vacancies is zero", () => {
  const label = regionAriaLabel(region({ vacancies: 0 }), EN, "en");
  assert.match(label, /: 0 open vacancies,/);
});
