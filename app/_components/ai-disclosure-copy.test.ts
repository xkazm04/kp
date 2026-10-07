// Pins the candidate-facing AI disclosure (`aiDisclosure.body`, rendered by
// AiDisclosure.tsx on ~8 public candidate surfaces in 4 locales) against the
// absolute it used to carry.
//
// WHY THIS TEST EXISTS — G16 (docs/features/compliance/ai-act-conformity.md).
// The retired sentence read:
//
//   "A human reviews and makes every advance, offer, and rejection decision;
//    nothing adverse is decided automatically."
//
// It was FALSE IN TWO THIRDS. The schema default is human-approved
// (`INTERVIEW_PLAN_DEFAULT` in app/_lib/decision-config-schema.ts), so a stock
// install told the truth — but a workspace that sets an interview-plan gate to
// `auto` makes app/_lib/automation-run.ts ratify the advance unattended through
// `actOnPipelineEntry` with `actor: "system"`, sealing decision kind
// `auto_advanced`; the offer branch extends an offer with no human either. Only
// the REJECTION third survives in every configuration — the machine cannot
// commit one and no setting can delegate it.
//
// This is compliance copy: GDPR Art. 13(2)(f) and AI Act Art. 50(1) (in force
// since 2 Aug 2026). So the failure mode guarded here is a future edit quietly
// restoring the comfortable absolute, not a rendering bug. The `<highlight>`
// assertion is the second half: the string is consumed by `t.rich`, and a
// catalog that loses the tag silently drops the emphasis in that locale.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCALES } from "../../i18n/locales.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));

type Catalog = { aiDisclosure?: { body?: unknown } };

function disclosureBody(locale: string): string {
  const raw = readFileSync(path.join(HERE, "..", "..", "messages", `${locale}.json`), "utf-8");
  const catalog = JSON.parse(raw) as Catalog;
  const body = catalog.aiDisclosure?.body;
  assert.equal(typeof body, "string", `${locale}: aiDisclosure.body must exist and be a string`);
  return body as string;
}

test("every locale carries a candidate-facing aiDisclosure.body", () => {
  for (const locale of LOCALES) {
    const body = disclosureBody(locale);
    assert.ok(body.length > 80, `${locale}: aiDisclosure.body is too thin to be a real disclosure`);
  }
});

test("the English body no longer carries the absolute that automation falsifies (G16)", () => {
  const body = disclosureBody("en");
  assert.doesNotMatch(
    body,
    /every advance, offer, and rejection/i,
    "the human-in-the-loop absolute is false whenever an interview-plan gate is set to `auto` (automation-run.ts seals `auto_advanced`)",
  );
  assert.doesNotMatch(
    body,
    /nothing adverse is decided automatically/i,
    "an unqualified 'nothing is automatic' cannot be true in every configuration",
  );
});

test("the English body still asserts the one guarantee that holds in every configuration", () => {
  const body = disclosureBody("en");
  // A rejection is always a person's — the machine cannot commit one and no
  // workspace setting can delegate it. This is the third of the old sentence
  // that survived, and dropping it would under-disclose rather than over-disclose.
  assert.match(body, /rejection/i, "the rejection guarantee must still be stated");
  assert.match(
    body,
    /no setting can hand that decision to the machine/i,
    "the rejection guarantee must say that no configuration can delegate it",
  );
  // The human-review affordance is a GDPR Art. 22(3) / AI Act Art. 26(2) hook,
  // not decoration: it must survive any rewrite of this string.
  assert.match(body, /human review/i, "the 'ask for a human review' affordance must survive");
});

// The apply knockout gate is AUTOMATIC: a no to a stated must-have ends the application
// with no person in front of it (recordKnockoutDecline, ko_declined, classed `auto`). The
// owner kept it that way and chose to say so — so while the gate exists, the disclosure
// must NOT say a rejection is always a person's without naming the exception, in every
// locale. Anchored to the code: if the gate is ever removed this test fails loudly and
// the absolute may harden again.
const EXCEPTION: Record<string, RegExp> = {
  en: /answering no to a must-have[^.]*ends an application automatically/i,
  cs: /odpověď „ne“ u požadavku[^.]*ukončí přihlášku automaticky/i,
  de: /mit Nein beantwortet[^.]*endet automatisch/i,
  fr: /répondre non à une condition[^.]*met fin à la candidature automatiquement/i,
};
const OTHER: Record<string, RegExp> = {
  en: /every other rejection is a person/i,
  cs: /každé jiné zamítnutí je na člověku/i,
  de: /jede andere ablehnung trifft ein mensch/i,
  fr: /tout autre rejet revient à une personne/i,
};

test("while the apply knockout gate exists, the disclosure in every locale names the must-have exception", () => {
  const gate = readFileSync(path.join(HERE, "..", "api", "apply", "[id]", "route.ts"), "utf-8");
  assert.match(gate, /failedKoStepIds\(/, "the apply KO gate is gone — the exception may be retired from the copy");
  assert.match(gate, /recordKnockoutDecline\(/, "the KO decline is no longer recorded here — re-check the claim");
  assert.deepEqual(Object.keys(EXCEPTION).sort(), [...LOCALES].sort(), "a locale was added with no exception pattern");
  for (const locale of LOCALES) {
    const body = disclosureBody(locale);
    assert.match(body, EXCEPTION[locale], `${locale}: the disclosure must say a no to a stated must-have ends the application automatically`);
    assert.match(body, OTHER[locale], `${locale}: …and that every OTHER rejection is a person's`);
    assert.doesNotMatch(
      body,
      /^[^.]*(rejection is always a person|zamítnutí je vždy na člověku|ablehnung trifft immer ein mensch|rejet revient toujours)/i,
      `${locale}: the unqualified absolute is false while the knockout gate is automatic`,
    );
  }
});

test("every locale keeps the <highlight> tag t.rich renders", () => {
  for (const locale of LOCALES) {
    const body = disclosureBody(locale);
    assert.match(body, /<highlight>/, `${locale}: opening <highlight> is required by t.rich in AiDisclosure.tsx`);
    assert.match(body, /<\/highlight>/, `${locale}: closing </highlight> is required by t.rich in AiDisclosure.tsx`);
  }
});

// The candidate interview portal's consent sentence (voice.consent / voice.consentRecordable)
// must name what the candidate is actually agreeing to: an AI scorecard and a recommendation.
test("the interview consent sentence names the AI scorecard and the recommendation, in every locale", () => {
  const words: Record<string, RegExp[]> = {
    en: [/scores the transcript/i, /recommendation/i],
    cs: [/vyhodnotí přepis/i, /doporučení/i],
    de: [/bewertet das Transkript/i, /Empfehlung/i],
    fr: [/note la transcription/i, /recommandation/i],
  };
  for (const locale of LOCALES) {
    const raw = readFileSync(path.join(HERE, "..", "..", "messages", `${locale}.json`), "utf-8");
    const voice = (JSON.parse(raw) as { interview?: { voice?: { consent?: string; consentRecordable?: string } } }).interview?.voice;
    for (const key of ["consent", "consentRecordable"] as const) {
      const text = voice?.[key];
      assert.equal(typeof text, "string", `${locale}: voice.${key} must exist`);
      for (const re of words[locale]) assert.match(text as string, re, `${locale}: voice.${key} must match ${re}`);
    }
    const note = (JSON.parse(raw) as { aiDisclosure?: { interviewData?: string } }).aiDisclosure?.interviewData;
    assert.match(note ?? "", /\{months/, `${locale}: aiDisclosure.interviewData states the retention window`);
  }
});
