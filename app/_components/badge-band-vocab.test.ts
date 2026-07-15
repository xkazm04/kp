// Match-surface hygiene (perfect: match-surface-hygiene). Two guards:
//
//   1. Badge stays LOCALE-DUMB for the confidence band. The band vocabulary
//      ("Tight band" / "Moderate band" / "Wide band", the "Why this band:"
//      tooltip prefix, and the tight-band fallback sentence) used to be hardcoded
//      English in Badge.tsx — rendering English on a Czech UI. It now comes from
//      the caller (match.band.* via useConfidenceBandCopy). A source-level guard
//      (kp convention: readFileSync + assert, like match-score.test.ts) keeps the
//      English literals from creeping back into the shared primitive.
//
//   2. The band + fit-tier catalog keys exist and are non-empty across ALL four
//      locales, so no surface silently falls back to a missing-key blank.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");

test("Badge.tsx holds no hardcoded English confidence-band vocabulary", () => {
  const src = readFileSync(path.join(here, "Badge.tsx"), "utf8");
  // The band label/aria vocabulary and the tooltip prose must be supplied by the
  // caller — none of these literals may live in the shared primitive.
  for (const banned of [
    '"Tight band"',
    '"Moderate band"',
    '"Wide band"',
    "Why this band:",
    "Narrow band —",
    "Confidence band: tight",
    "Confidence band: wide",
    "Confidence band: moderate",
  ]) {
    assert.ok(!src.includes(banned), `Badge.tsx must not hardcode band vocabulary: ${banned}`);
  }
  // The token/title/wrappers must take a localized `copy` argument (dumb primitive).
  assert.match(src, /confidenceBandToken\(level: string, copy: ConfidenceBandCopy\)/);
  assert.match(src, /confidenceBandTitle\(drivers: string\[\] = \[\], copy: ConfidenceBandCopy\["title"\]\)/);
});

test("band + fitTier catalog keys are present and non-empty in every locale", () => {
  for (const locale of ["en", "cs", "de", "fr"]) {
    const msgs = JSON.parse(readFileSync(path.join(repo, "messages", `${locale}.json`), "utf8"));
    const band = msgs?.match?.band;
    const fit = msgs?.match?.fitTier;
    assert.ok(band, `${locale}: match.band missing`);
    for (const level of ["tight", "moderate", "wide"] as const) {
      assert.ok(band[level]?.label?.length, `${locale}: match.band.${level}.label empty`);
      assert.ok(band[level]?.aria?.length, `${locale}: match.band.${level}.aria empty`);
    }
    assert.ok(band.titlePrefix?.length, `${locale}: match.band.titlePrefix empty`);
    assert.ok(band.titleFallback?.length, `${locale}: match.band.titleFallback empty`);
    assert.ok(fit, `${locale}: match.fitTier missing`);
    for (const tier of ["strong", "promising", "partial", "unknown"] as const) {
      assert.ok(fit[tier]?.length, `${locale}: match.fitTier.${tier} empty`);
    }
  }
});
