import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFeedbackBrief } from "./devcase-feedback.ts";

const NO_ADVERSE = /reject|unsuccessful|not selected|declined|turned down|did not pass/i;

test("builds a warm brief with strengths and reframed growth areas", async () => {
  const b = await buildFeedbackBrief({
    candidateRef: "Alex",
    roleTitle: "Backend Engineer",
    strengths: ["Clear commit hygiene", "Good test coverage"],
    concerns: ["Limited error handling"],
    gaps: ["No async experience shown"],
  });
  assert.match(b.subject, /Backend Engineer/);
  assert.match(b.body, /Hi Alex,/);
  assert.match(b.body, /What stood out:/);
  assert.match(b.body, /Clear commit hygiene/);
  assert.match(b.body, /Areas to keep growing:/);
  assert.match(b.body, /Limited error handling/);
  assert.match(b.body, /No async experience shown/); // gaps fold into growth
});

test("carries NO adverse / rejection wording — that stays human-gated", async () => {
  const b = await buildFeedbackBrief({
    candidateRef: "Sam",
    roleTitle: "Data Eng",
    strengths: ["X"],
    concerns: ["Y"],
    gaps: [],
  });
  assert.doesNotMatch(b.body, NO_ADVERSE);
  assert.doesNotMatch(b.subject, NO_ADVERSE);
});

test("an empty evaluation still yields a kind, non-empty note", async () => {
  const b = await buildFeedbackBrief({ candidateRef: "Pat", roleTitle: null, strengths: [], concerns: [], gaps: [] });
  assert.match(b.body, /appreciated your effort/i);
  assert.doesNotMatch(b.body, NO_ADVERSE);
  assert.doesNotMatch(b.body, /What stood out/); // no empty section header
});

test("blank entries are dropped, not rendered as empty bullets", async () => {
  const b = await buildFeedbackBrief({ candidateRef: "Lee", strengths: ["Real", "  "], concerns: [""], gaps: [] });
  const bullets = b.body.split("\n").filter((l) => l.startsWith("- "));
  assert.deepEqual(bullets, ["- Real"]);
});

test("falls back to a generic greeting/subject when fields are missing", async () => {
  const b = await buildFeedbackBrief({ candidateRef: "", strengths: [], concerns: [], gaps: [] });
  assert.match(b.body, /Hi there,/);
  assert.match(b.subject, /take-home exercise/i);
});

// --- narrativeLang: the bullets are the evaluator's own sentences ------------
//
// The frame of this letter is localized and the bullets are NOT translated here (they
// are scored findings; re-translating one client-side would put words in the
// assessment's mouth). So the letter has to be honest about the language its findings
// are in — silently mixing a Czech heading with English bullets reads as a broken
// template, which is the state this pass found.

test("a letter whose bullets are in the reader's language carries no engine note", async () => {
  const b = await buildFeedbackBrief({
    candidateRef: "Eva",
    locale: "cs",
    narrativeLang: "cs",
    strengths: ["Ve stopě práce jsou vidět návyky ověřování"],
    concerns: [],
    gaps: [],
  });
  assert.doesNotMatch(b.body, /moteur|engine|systém|System/i);
});

test("English bullets under a non-English letter are labelled, in the reader's language", async () => {
  const b = await buildFeedbackBrief({
    candidateRef: "Eva",
    locale: "cs",
    narrativeLang: "en",
    strengths: ["Shows verification habits in the trace"],
    concerns: [],
    gaps: [],
  });
  assert.match(b.body, /Poznámka k tomuto dopisu/);
  assert.match(b.body, /EN/); // names WHICH language the findings are in
  // …and it is a footnote, not part of the assessment: after the bullets, before signoff.
  assert.ok(b.body.indexOf("Poznámka k tomuto dopisu") > b.body.indexOf("Shows verification habits"));
});

test("the engine note renders in every locale we ship", async () => {
  const expected: Record<string, RegExp> = {
    en: /A note on this letter/,
    cs: /Poznámka k tomuto dopisu/,
    de: /Hinweis zu diesem Schreiben/,
    fr: /Remarque sur cette lettre/,
  };
  for (const [locale, pattern] of Object.entries(expected)) {
    const b = await buildFeedbackBrief({
      candidateRef: "Eva",
      locale,
      narrativeLang: locale === "en" ? "de" : "en",
      strengths: ["A finding"],
      concerns: [],
      gaps: [],
    });
    assert.match(b.body, pattern, `${locale} letter did not carry its own engine note`);
  }
});

test("an UNSTAMPED bundle makes no claim about the language — no note", async () => {
  // Bundles scored before the evaluator took a --lang carry no narrativeLang. Guessing
  // "English" for them would print a confident note about a language nobody recorded.
  const b = await buildFeedbackBrief({
    candidateRef: "Eva",
    locale: "cs",
    strengths: ["A finding"],
    concerns: [],
    gaps: [],
  });
  assert.doesNotMatch(b.body, /Poznámka k tomuto dopisu/);
});

test("no bullets means nothing to qualify — the note stays off", async () => {
  const b = await buildFeedbackBrief({
    candidateRef: "Eva",
    locale: "cs",
    narrativeLang: "en",
    strengths: [],
    concerns: [],
    gaps: [],
  });
  assert.doesNotMatch(b.body, /Poznámka k tomuto dopisu/);
});
