import { test } from "node:test";
import assert from "node:assert/strict";
import { addLanguage, MAX_LANGUAGES, normalizeLanguages, readLanguage, removeLanguage, setLanguageLevel } from "./languageEntries";
import { languageLines } from "../cv/cvContent";

test("CV-read languages normalise into the stored 'Name (level)' shape, never inventing a level", () => {
  assert.deepEqual(normalizeLanguages(["Czech – native speaker", "English - c1", "german (fluent)", "Polish", "  ", "czech (A2)"]), [
    "Czech (native)",
    "English (C1)",
    "german (fluent)",
    "Polish",
  ]);
  assert.deepEqual(readLanguage("Swiss-German"), { name: "Swiss-German", level: null });
});

test("add trims, dedupes case-insensitively, reads a typed level and stops at the cap", () => {
  assert.deepEqual(addLanguage(["German (B2)"], "  french (b1) "), ["German (B2)", "french (B1)"]);
  assert.deepEqual(addLanguage(["German (B2)"], "GERMAN"), ["German (B2)"]);
  assert.deepEqual(addLanguage(["German (B2)"], "x".repeat(41)), ["German (B2)"]);
  const full = Array.from({ length: MAX_LANGUAGES }, (_, i) => `Lang${i}`);
  assert.deepEqual(addLanguage(full, "Czech"), full);
});

test("a level is set, cleared or made native; remove drops one entry", () => {
  const list = ["Czech", "English (B2)"];
  assert.deepEqual(setLanguageLevel(list, 0, "native"), ["Czech (native)", "English (B2)"]);
  assert.deepEqual(setLanguageLevel(list, 1, null), ["Czech", "English"]);
  assert.deepEqual(setLanguageLevel(list, 1, "C2"), ["Czech", "English (C2)"]);
  assert.deepEqual(removeLanguage(list, 0), ["English (B2)"]);
});

test("the stored shape is exactly what the designed CV reads back", () => {
  assert.deepEqual(languageLines(null, ["Czech (native)", "English (C1)", "german (fluent)", "Polish"], "de"), ["Czech – Muttersprache", "English – C1", "German – fluent", "Polish"]);
});
