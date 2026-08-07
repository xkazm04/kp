// Pins the retention-disclosure contract (backlog #35b / REC-08 / capst-l1-005):
// the duration candidates see ("up to N months") is DERIVED from the enforced
// KP_CONSENT_TTL_DAYS — never a hardcoded "12 months" — so an operator retune
// can no longer silently falsify the GDPR statement at the point of consent.
// Covers the pure helpers AND both candidate-facing catalog strings
// (aiDisclosure.dataConsent, decisions.compliance.covered5) in both locales,
// including the Czech one/few/other plural forms.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { consentRetentionMonths, consentTtlDays } from "./consent.ts";

afterEach(() => {
  delete process.env.KP_CONSENT_TTL_DAYS;
});

test("consentRetentionMonths derives the displayed ceiling from the enforced TTL, rounding UP", () => {
  assert.equal(consentRetentionMonths(365), 12, "the default 365 days reads as the familiar 12 months");
  assert.equal(consentRetentionMonths(180), 6);
  assert.equal(consentRetentionMonths(30), 1);
  assert.equal(consentRetentionMonths(3650), 120);
  // Rounding must never UNDER-disclose (the GDPR-worse direction): 400 enforced
  // days must read "up to 14 months" (13 months = 395.4 days would be shorter
  // than the enforced window).
  assert.equal(consentRetentionMonths(400), 14);
  assert.equal(consentRetentionMonths(1), 1, "never displays zero months");
});

test("a changed KP_CONSENT_TTL_DAYS env changes the disclosed duration (read at call time)", () => {
  delete process.env.KP_CONSENT_TTL_DAYS;
  assert.equal(consentTtlDays(), 365);
  assert.equal(consentRetentionMonths(), 12);

  process.env.KP_CONSENT_TTL_DAYS = "180";
  assert.equal(consentTtlDays(), 180);
  assert.equal(consentRetentionMonths(), 6, "the consent copy's number follows the env without a code change");

  // Out-of-range values fall back to the clamped default, same as enforcement.
  process.env.KP_CONSENT_TTL_DAYS = "999999";
  assert.equal(consentTtlDays(), 365);
});

type Catalog = Record<string, unknown>;
function catalog(locale: "en" | "cs"): Catalog {
  return JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8")) as Catalog;
}
function render(locale: "en" | "cs", namespace: string, key: string, values: Record<string, string | number>): string {
  const t = createTranslator({ locale, messages: catalog(locale), namespace } as never) as unknown as (
    k: string,
    v?: Record<string, string | number>
  ) => string;
  return t(key, values);
}

test("consent copy interpolates the effective months in both locales (no hardcoded 12)", () => {
  // en: simple one/other plural.
  assert.match(render("en", "aiDisclosure", "dataConsent", { months: 6 }), /up to 6 months/);
  assert.match(render("en", "aiDisclosure", "dataConsent", { months: 1 }), /up to 1 month\b/);
  // cs: one/few/other — 1 měsíc, 3 měsíce, 12 měsíců.
  assert.match(render("cs", "aiDisclosure", "dataConsent", { months: 1 }), /po dobu až 1 měsíc/);
  assert.match(render("cs", "aiDisclosure", "dataConsent", { months: 3 }), /po dobu až 3 měsíce/);
  assert.match(render("cs", "aiDisclosure", "dataConsent", { months: 12 }), /po dobu až 12 měsíců/);

  // Compliance posture line states the same derived number.
  assert.match(render("en", "decisions.compliance", "covered5", { dataLaw: "GDPR", months: 6 }), /6-month retention window/);
  assert.match(render("cs", "decisions.compliance", "covered5", { dataLaw: "GDPR", months: 6 }), /dobou uchování 6 měsíců/);

  // And the raw catalogs no longer hardcode the number anywhere in these keys.
  for (const locale of ["en", "cs"] as const) {
    const raw = JSON.stringify(catalog(locale));
    assert.ok(!raw.includes("up to 12 months"), `${locale}: dataConsent must not hardcode 12 months`);
    assert.ok(!raw.includes("po dobu až 12 měsíců"), `${locale}: dataConsent must not hardcode 12 měsíců`);
    assert.ok(!raw.includes("12-month retention"), `${locale}: covered5 must not hardcode a 12-month window`);
    assert.ok(!raw.includes("uchování 12 měsíců"), `${locale}: covered5 must not hardcode 12 měsíců`);
  }
});
