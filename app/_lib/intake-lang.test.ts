// The intake dialog's language resolution, plus a SOURCE GUARD that the six
// hand-written clamps it replaced cannot come back.
//
// The defect: every intake route wrote `lang === "cs" ? "cs" : "en"`, so a
// German or French operator — whose workspace chrome is fully localized, and
// whose language `pipeline/jobfit/i18n.py` has named in `LANG_NAMES` all along —
// was answered by an intake agent speaking English. Six copies of one ternary,
// each of which had to be found before any could be fixed.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { intakeLang } from "./intake-lang.ts";
import { LOCALES } from "../../i18n/locales.ts";

test("every locale this product ships is a dialog language", () => {
  for (const locale of LOCALES) assert.equal(intakeLang(locale), locale);
  // The two the clamps used to drop on the floor, named explicitly.
  assert.equal(intakeLang("de"), "de");
  assert.equal(intakeLang("fr"), "fr");
});

test("the primary subtag decides, and anything unknown is English", () => {
  // The value on the row is whatever the client sent at creation.
  assert.equal(intakeLang("de-AT"), "de");
  assert.equal(intakeLang("CS-CZ"), "cs");
  assert.equal(intakeLang(" fr "), "fr");
  // Never a language nothing downstream knows: an unknown tag would reach a
  // prompt as an invented target language.
  assert.equal(intakeLang("klingon"), "en");
  assert.equal(intakeLang(""), "en");
  assert.equal(intakeLang(null), "en");
  assert.equal(intakeLang(undefined), "en");
  assert.equal(intakeLang(42), "en");
});

const ROUTES = [
  "../api/intake/route.ts",
  "../api/intake/[id]/message/route.ts",
  "../api/intake/[id]/promote/route.ts",
  "../api/intake/[id]/voice-connect/route.ts",
  "../api/intake/[id]/voice-turn/route.ts",
  "../api/intake/[id]/voice-complete/route.ts",
];

test("no role-intake route clamps the dialog language by hand again", () => {
  for (const rel of ROUTES) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    assert.ok(
      !/=== "cs" \? "cs" : "en"/.test(src),
      `${rel}: the cs-or-en ternary is back — resolve through intakeLang so a fifth locale needs one edit, in i18n/locales.ts`
    );
    assert.match(src, /import \{ intakeLang \} from "@\/app\/_lib\/intake-lang"/, `${rel}: no intakeLang import`);
  }
});

// The row's language is what reaches the spawn: `intake-run.ts` puts it on the
// CLI as `--lang <value>`, and Python's `normalize_lang` keeps it only if
// `LANG_NAMES` has it. So pinning the route's resolution plus this helper's
// output pins the whole chain — a `de` session arrives at the prompt as German.
test("the dialog and voice turns take their language from the session row", () => {
  const message = readFileSync(fileURLToPath(new URL("../api/intake/[id]/message/route.ts", import.meta.url)), "utf8");
  const voiceTurn = readFileSync(fileURLToPath(new URL("../api/intake/[id]/voice-turn/route.ts", import.meta.url)), "utf8");
  assert.match(message, /lang: intakeLang\(intake\.lang\)/);
  assert.match(voiceTurn, /const lang = intakeLang\(intake\.lang\);/);
  // …and that resolved value is the one handed to the spawn, not a second copy.
  assert.match(voiceTurn, /runIntakeVoiceTurn\(\s*\n?\s*\{[^}]*message,\s*lang,/);
  const run = readFileSync(fileURLToPath(new URL("./intake-run.ts", import.meta.url)), "utf8");
  assert.match(run, /"--lang",\s*\n?\s*input\.lang \|\| "en",/);
});
