// Pins the Analyze draft codec: text fields plus the two run-config flags
// (blind, reportLang) that used to die on a workspace tab unmount.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOCALES } from "@/i18n/locales.ts";
import {
  parseAnalyzeDraft,
  restoreDraftBlind,
  restoreDraftLocale,
  restoreDraftValue,
  serializeAnalyzeDraft,
} from "./analyzeDraft.ts";

test("reportLang round-trips for every supported locale", () => {
  assert.equal(LOCALES.length, 4);
  for (const loc of LOCALES) {
    const serialized = serializeAnalyzeDraft({ reportLang: loc });
    assert.deepEqual(parseAnalyzeDraft(serialized), { reportLang: loc }, loc);
  }
});

test("an unknown reportLang is dropped, never restored into the select", () => {
  assert.equal(parseAnalyzeDraft(JSON.stringify({ reportLang: "zz" })), null);
  assert.equal(parseAnalyzeDraft(JSON.stringify({ reportLang: 2 })), null);
  const kept = parseAnalyzeDraft(JSON.stringify({ jd: "keep", reportLang: "nope" }));
  assert.deepEqual(kept, { jd: "keep" });
});

test("blind true round-trips; false is the default and is omitted", () => {
  assert.deepEqual(parseAnalyzeDraft(serializeAnalyzeDraft({ blind: true })), { blind: true });
  assert.equal(serializeAnalyzeDraft({ blind: false }), null);
  assert.deepEqual(
    JSON.parse(serializeAnalyzeDraft({ jd: "Backend", blind: false })!),
    { jd: "Backend" },
    "false does not ride along as a stored flag",
  );
  assert.deepEqual(parseAnalyzeDraft(JSON.stringify({ blind: false })), { blind: false });
  assert.equal(parseAnalyzeDraft(JSON.stringify({ blind: "yes" })), null);
});

test("blind and reportLang survive together across a serialize/parse hop", () => {
  for (const loc of LOCALES) {
    for (const blind of [true, false]) {
      const serialized = serializeAnalyzeDraft({ reportLang: loc, blind });
      const parsed = parseAnalyzeDraft(serialized);
      assert.equal(parsed?.reportLang, loc, loc);
      if (blind) assert.equal(parsed?.blind, true);
      else assert.equal(parsed?.blind, undefined);
    }
  }
});

test("restore of the flags only fills a field still at its mount default", () => {
  assert.equal(restoreDraftLocale("en", "cs", "en"), "cs");
  assert.equal(restoreDraftLocale("de", "cs", "en"), "de", "a choice made this mount wins");
  assert.equal(restoreDraftLocale("en", "zz", "en"), "en", "junk locale is not restored");
  assert.equal(restoreDraftLocale("en", undefined, "en"), "en");
  assert.equal(restoreDraftBlind(false, true), true);
  assert.equal(restoreDraftBlind(true, false), true, "a choice made this mount wins");
  assert.equal(restoreDraftBlind(false, undefined), false);
  assert.equal(restoreDraftValue("", "stale"), "stale");
});

test("the form serializes and restores the flags through the shared codec", () => {
  const form = readFileSync(fileURLToPath(new URL("./useAnalyzeForm.ts", import.meta.url)), "utf8");
  assert.match(form, /restoreDraftLocale\(prev, draftedLang, localeDefault\)/);
  assert.match(form, /restoreDraftBlind\(prev, draftedBlind\)/);
  assert.match(form, /reportLang,\s*\n\s*blind,/);
  assert.match(form, /jobDescriptionText, companyText, githubProfile, reportLang, blind/);
});
