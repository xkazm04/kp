import { test } from "node:test";
import assert from "node:assert/strict";
import { splitJobAds } from "./split-ads.ts";

const AD_A = "Senior Backend Engineer at Acme — Prague, hybrid. Build Go services. 120000 CZK.";
const AD_B = "Frontend Developer at Beta — remote. React/TypeScript. 90000 CZK monthly.";

test("splits a multi-ad paste on a --- separator line", () => {
  const ads = splitJobAds(`${AD_A}\n---\n${AD_B}`);
  assert.equal(ads.length, 2);
  assert.equal(ads[0], AD_A);
  assert.equal(ads[1], AD_B);
});

test("splits on dash separators of varied length, incl. em/en dashes", () => {
  assert.equal(splitJobAds(`${AD_A}\n--------\n${AD_B}`).length, 2);
  assert.equal(splitJobAds(`${AD_A}\n  ———  \n${AD_B}`).length, 2); // em dash
  assert.equal(splitJobAds(`${AD_A}\n–––\n${AD_B}`).length, 2); // en dash
});

// bug-ui-scan-2026-07-09 (job-postings-lifecycle #3): the separator alphabet used to
// include = _ *, so a single ad carrying an in-body setext heading underline (`===`),
// an `___` or `***` thematic break was shredded into several garbage jobs. Only
// dashes divide ads now. NON-VACUITY: pre-fix each of these lines matched the
// separator, so the paste split into 2+ chunks and every assert.equal(..., 1) failed.
test("does NOT split on ===, ___ or *** — those are in-body markdown, not ad boundaries", () => {
  assert.equal(splitJobAds(`${AD_A}\n======\n${AD_B}`).length, 1);
  assert.equal(splitJobAds(`${AD_A}\n___\n${AD_B}`).length, 1);
  assert.equal(splitJobAds(`${AD_A}\n***\n${AD_B}`).length, 1);
});

test("a single ad (no separator) returns one chunk", () => {
  assert.deepEqual(splitJobAds(AD_A), [AD_A]);
});

test("drops empty/too-short chunks (stray separators, trailing blanks)", () => {
  assert.deepEqual(splitJobAds(`${AD_A}\n---\n\n---\n   \n---\n${AD_B}`), [AD_A, AD_B]);
  assert.equal(splitJobAds("").length, 0);
  assert.equal(splitJobAds("short\n---\nalso short").length, 0);
});

test("does not split a dashed line INSIDE an ad's prose (separator must be its own line)", () => {
  const ad = `${AD_A} -- note: dashes inline stay -- ${AD_B}`;
  assert.equal(splitJobAds(ad).length, 1);
});
