import { test } from "node:test";
import assert from "node:assert/strict";
import { languageIds, languageMentions } from "./jd-languages.ts";

test("every form of a language resolves to ONE canonical id", () => {
  for (const form of ["Czech", "Čeština", "češtiny", "češtinu", "češtině", "češtinou", "česky", "Tschechisch", "Tchèque", "český jazyk", "českého jazyka"]) {
    assert.deepEqual(languageIds(form), ["cs"], form);
  }
  for (const form of ["English", "angličtina", "anglicky", "Englisch", "Anglais", "anglický jazyk", "znalost anglického jazyka"]) {
    assert.deepEqual(languageIds(form), ["en"], form);
  }
});

test("the lexicon covers eleven languages in their own name, en, cs, de and fr", () => {
  const forms: Record<string, string[]> = {
    cs: ["Czech", "čeština", "Tschechisch", "tchèque"],
    sk: ["Slovak", "slovenština", "Slowakisch", "slovaque"],
    en: ["English", "angličtina", "Englisch", "anglais"],
    de: ["German", "němčina", "Deutsch", "allemand"],
    pl: ["Polish", "polština", "Polnisch", "polonais", "polski"],
    fr: ["French", "francouzština", "Französisch", "français"],
    es: ["Spanish", "španělština", "Spanisch", "espagnol", "español"],
    it: ["Italian", "italština", "Italienisch", "italien", "italiano"],
    ru: ["Russian", "ruština", "Russisch", "russe"],
    uk: ["Ukrainian", "ukrajinština", "Ukrainisch", "ukrainien"],
    hu: ["Hungarian", "maďarština", "Ungarisch", "hongrois", "magyar"],
  };
  for (const [id, names] of Object.entries(forms)) for (const n of names) assert.deepEqual(languageIds(n), [id], `${id}: ${n}`);
});

test("a Czech adjective counts only beside 'jazyk'; the adverb counts alone", () => {
  assert.deepEqual(languageIds("německá firma"), []);
  assert.deepEqual(languageIds("německý jazyk"), ["de"]);
  assert.deepEqual(languageIds("jazyk německý"), ["de"]);
  assert.deepEqual(languageIds("mluví německy"), ["de"]);
  assert.deepEqual(languageIds("slovenská pobočka"), []);
});

test("a name outside the lexicon resolves to nothing", () => {
  assert.deepEqual(languageIds("Klingon"), []);
  assert.deepEqual(languageIds("Rust"), []);
});

test("a mention is stated unless every one of its clauses carries a negation cue", () => {
  const m = (t: string) => languageMentions(t);
  assert.deepEqual([...m("Fluent English required").stated], ["en"]);
  assert.deepEqual([...m("No English needed").negated], ["en"]);
  assert.equal(m("No English needed").stated.size, 0);
  assert.deepEqual([...m("bez angličtiny").negated], ["en"]);
  assert.deepEqual([...m("angličtina není nutná").negated], ["en"]);
  assert.deepEqual([...m("Nevyžadujeme angličtinu").negated], ["en"]);
  assert.deepEqual([...m("English without German").stated], []); // one clause: both negated
  // One negated clause does not cancel a stated one.
  assert.deepEqual([...m("English required.\nNo English for support roles.").stated], ["en"]);
  // A comma ends the negation scope.
  assert.deepEqual([...m("No German, English required").stated], ["en"]);
  assert.deepEqual([...m("No German, English required").negated], ["de"]);
});
