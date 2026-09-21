// The public locale strip's visible glyph is the ISO code. Its accessible name
// has to be the endonym (`language.en` → "English") so a reader who cannot
// read the current UI still finds their language. SetupLanguageSwitch already
// does this; this file pins the public switcher to the same contract.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, "LanguageSwitcher.tsx"), "utf8");

test("each public locale button exposes its catalog endonym to AT", () => {
  assert.match(src, /useTranslations\("language"\)/, "buttons resolve names from the language catalog");
  assert.match(src, /className="sr-only">\{t\(locale\)\}<\/span>/, "the endonym is the accessible name");
  assert.match(src, /<span aria-hidden>\{locale\}<\/span>/, "the ISO code stays visual-only so AT does not hear both");
});
