// The KEYLESS interview feedback letter (spark interview-feedback-letter, WP-alpha), rendered
// through the REAL four catalogs: every sentence is catalog copy, every competency is a rubric
// catalog label, and nothing a candidate said — nor any rating — can reach it.
//
// The Python half (pipeline/jobfit/tests/test_interview_letter.py) proves the drafting CLI
// hands this template NAMES only; this file proves the template cannot print anything else
// even when handed something else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { namespaceTranslator } from "./catalog-translator.ts";
import { buildInterviewLetterTemplate, letterAreaLabel } from "./interview-letter-template.ts";
import { LETTER_MAX_CHARS } from "./interview-letter-types.ts";
import { LOCALES } from "../../i18n/locales.ts";

// Distinctive words a candidate said in their interview. The record holds them; the letter
// must never.
const SPOKEN = ["I rewrote the Zanzibar ledger over one rainy weekend", "our purple giraffe deployment pipeline never slept"];

async function translators(locale: (typeof LOCALES)[number]) {
  return Promise.all([namespaceTranslator(locale, "interviewLetter.template"), namespaceTranslator(locale, "rubric.competency")]);
}

test("every locale renders a complete letter from catalog copy and rubric labels, under the cap", async () => {
  for (const locale of LOCALES) {
    const [t, rubric] = await translators(locale);
    for (const outcome of ["not_selected", "hired"] as const) {
      const text = buildInterviewLetterTemplate(
        { outcome, jobTitle: "Backend Engineer", wentWell: ["Technical depth", "Communication"], toWorkOn: ["Problem-solving"] },
        t,
        rubric
      );
      assert.ok(text.length > 100 && text.length < LETTER_MAX_CHARS, `${locale}/${outcome}: a short letter, well under the cap (${text.length})`);
      assert.doesNotMatch(text, /[{}]/, `${locale}/${outcome}: no unresolved placeholder`);
      assert.doesNotMatch(text, /interviewLetter\.|rubric\./, `${locale}/${outcome}: no missing-key fallback`);
      assert.doesNotMatch(text, /\d/, `${locale}/${outcome}: no digit, so no rating`);
      assert.match(text, /Backend Engineer/, `${locale}/${outcome}: the role is named`);
      for (const name of ["technical_depth", "communication", "problem_solving"]) {
        assert.ok(text.includes(rubric(`${name}.label`)), `${locale}/${outcome}: the ${name} area is named in the letter's language`);
      }
      assert.doesNotMatch(text, /—/, `${locale}/${outcome}: no em dash (contract.md §5)`);
    }
  }
});

test("the outcome changes the frame and the close — never which areas are named", async () => {
  const [t, rubric] = await translators("en");
  const input = { jobTitle: "Backend Engineer", wentWell: ["Technical depth"], toWorkOn: ["Problem-solving"] };
  const rejected = buildInterviewLetterTemplate({ ...input, outcome: "not_selected" }, t, rubric);
  const hired = buildInterviewLetterTemplate({ ...input, outcome: "hired" }, t, rubric);
  assert.notEqual(rejected, hired);
  assert.ok(hired.includes(t("closeHired")) && !rejected.includes(t("closeHired")));
  assert.ok(rejected.includes(t("closeNotSelected")) && !hired.includes(t("closeNotSelected")));
  const areas = (text: string) => text.split("\n").filter((line) => line.startsWith("•"));
  assert.deepEqual(areas(rejected), areas(hired), "the same record names the same areas either way");
});

test("a name the rubric catalog does not know is DROPPED — the candidate's words cannot get in", async () => {
  for (const locale of LOCALES) {
    const [t, rubric] = await translators(locale);
    const text = buildInterviewLetterTemplate(
      { outcome: "not_selected", jobTitle: "Backend Engineer", wentWell: [SPOKEN[0], "Technical depth"], toWorkOn: [SPOKEN[1], "4/5", ""] },
      t,
      rubric
    );
    for (const phrase of SPOKEN) assert.ok(!text.toLowerCase().includes(phrase.toLowerCase()), `${locale}: "${phrase}" must not appear`);
    assert.doesNotMatch(text, /zanzibar|giraffe|4\/5|\d/i, `${locale}: no candidate phrase, no rating`);
    assert.ok(text.includes(rubric("technical_depth.label")), `${locale}: the real area still renders`);
    assert.ok(!text.includes(t("toWorkOnIntro")), `${locale}: a list emptied by the filter renders no heading`);
  }
});

test("an empty record says so in one plain line instead of inventing areas", async () => {
  const [t, rubric] = await translators("cs");
  const text = buildInterviewLetterTemplate({ outcome: "hired", jobTitle: null, wentWell: [], toWorkOn: [] }, t, rubric);
  assert.ok(text.includes(t("noSpecifics")));
  assert.ok(text.includes(t("thanks")), "no role title → the role-free thanks");
  assert.ok(!text.includes(t("wentWellIntro")) && !text.includes(t("toWorkOnIntro")));
});

test("an area praised is never also handed back as one to work on", async () => {
  const [t, rubric] = await translators("de");
  const text = buildInterviewLetterTemplate(
    { outcome: "not_selected", jobTitle: "QA", wentWell: ["Communication"], toWorkOn: ["Communication"] },
    t,
    rubric
  );
  assert.equal(text.split(rubric("communication.label")).length - 1, 1);
  assert.ok(!text.includes(t("toWorkOnIntro")));
});

test("letterAreaLabel maps a canonical name through the rubric catalog, or refuses it", async () => {
  const rubric = await namespaceTranslator("fr", "rubric.competency");
  assert.equal(letterAreaLabel("Experience & fit", rubric), rubric("experience_fit.label"));
  assert.equal(letterAreaLabel("Not a competency", rubric), null);
  assert.equal(letterAreaLabel(42, rubric), null);
});
