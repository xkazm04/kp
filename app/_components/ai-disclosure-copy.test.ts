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

test("every locale keeps the <highlight> tag t.rich renders", () => {
  for (const locale of LOCALES) {
    const body = disclosureBody(locale);
    assert.match(body, /<highlight>/, `${locale}: opening <highlight> is required by t.rich in AiDisclosure.tsx`);
    assert.match(body, /<\/highlight>/, `${locale}: closing </highlight> is required by t.rich in AiDisclosure.tsx`);
  }
});
