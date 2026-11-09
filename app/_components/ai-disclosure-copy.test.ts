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

// The apply knockout gate is a HOLD, not a decision (owner ruling Q1, 2026-11-09): a no to
// a stated must-have files an entry held for a person, who confirms the rejection or clears
// the hold (knockout-hold.ts). It replaced the automatic decline ADR 0019 recorded, so the
// disclosure now says "every rejection is a person's" with no exception, and says what a no
// to a must-have does instead. Anchored to the code: if the door ever declines on its own
// again this test fails loudly and the claim must be restated.
const HELD: Record<string, RegExp> = {
  en: /answering no to a must-have[^.]*held for a person[^.]*only a person's confirmation rejects it/i,
  cs: /odpověď „ne“ u požadavku[^.]*čeká na člověka[^.]*zamítne ji teprve jeho potvrzení/i,
  de: /mit Nein beantwortet[^.]*für einen Menschen zurückgehalten[^.]*erst dessen Bestätigung lehnt sie ab/i,
  fr: /répondre non à une condition[^.]*mise en attente pour une personne[^.]*seule sa confirmation la rejette/i,
};
const EVERY: Record<string, RegExp> = {
  en: /every rejection is a person/i,
  cs: /každé zamítnutí je na člověku/i,
  de: /jede ablehnung trifft ein mensch/i,
  fr: /tout rejet revient à une personne/i,
};
const RETIRED_AUTOMATIC: Record<string, RegExp> = {
  en: /ends an application automatically|every other rejection/i,
  cs: /ukončí přihlášku automaticky|každé jiné zamítnutí/i,
  de: /endet automatisch|jede andere ablehnung/i,
  fr: /met fin à la candidature automatiquement|tout autre rejet/i,
};

test("while the apply knockout gate is a hold, the disclosure in every locale says so and claims no automatic decline", () => {
  const gate = readFileSync(path.join(HERE, "..", "api", "apply", "[id]", "route.ts"), "utf-8");
  assert.match(gate, /failedKoStepIds\(/, "the apply KO gate is gone — the sentence may be retired from the copy");
  assert.match(gate, /hold: \{ failedKoIds: failedKo \}/, "the KO gate no longer files a hold — re-check the claim");
  assert.doesNotMatch(gate, /recordKnockoutDecline\(|dispatchKnockoutDecline\(/, "the KO gate declines on its own again — the disclosure is then false");
  assert.deepEqual(Object.keys(HELD).sort(), [...LOCALES].sort(), "a locale was added with no hold pattern");
  for (const locale of LOCALES) {
    const body = disclosureBody(locale);
    assert.match(body, HELD[locale], `${locale}: the disclosure must say a no to a stated must-have is held for a person, and only a person's confirmation rejects`);
    assert.match(body, EVERY[locale], `${locale}: …and that every rejection is a person's`);
    assert.doesNotMatch(body, RETIRED_AUTOMATIC[locale], `${locale}: the retired automatic-knockout exception is back in the disclosure`);
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
