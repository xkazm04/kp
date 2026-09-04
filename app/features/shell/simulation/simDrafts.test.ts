// One test per locale for the simulation's two deterministic drafts.
//
// The defect: both were English literals in the route handlers, and BOTH land in
// the product — the screening rationale in the Decisions approval card, the offer
// subject/body in the letter dispatchOffer sends the candidate. A cs/de/fr
// workspace watched a fully localized tour and then read English in the two places
// that matter most.
//
// Rendered from the SAME catalogs the routes load, so a copy edit can't break these:
// they pin the LANGUAGE choice and the placeholder wiring, not the prose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { LOCALES, type Locale } from "@/i18n/locales";
import { buildSimOfferDraft, buildSimScreenDraft, type SimDraftTranslator } from "./simDrafts.ts";

const ROOT = path.join(process.cwd(), "messages");
function translator(locale: Locale): SimDraftTranslator {
  const messages = JSON.parse(readFileSync(path.join(ROOT, `${locale}.json`), "utf-8"));
  return createTranslator({ locale, messages, namespace: "simulation" }) as unknown as SimDraftTranslator;
}

const KEYS = [
  "draft.theRole",
  "draft.theCandidate",
  "draft.screen.rationale",
  "draft.screen.strengthStack",
  "draft.screen.strengthSeniority",
  "draft.offer.subject",
  "draft.offer.body",
  "draft.offer.rationale",
] as const;

test("every draft key exists in all four catalogs", () => {
  for (const locale of LOCALES) {
    const t = translator(locale);
    const missing = KEYS.filter((k) => !t.has(k));
    assert.deepEqual(missing, [], `${locale}: simulation.${missing.join(", ")} missing`);
  }
});

for (const locale of LOCALES) {
  test(`${locale}: the screening draft renders from the ${locale} catalog`, () => {
    const t = translator(locale);
    const draft = buildSimScreenDraft(t, "Backend Engineer");
    assert.equal(draft.recommendation, "advance");
    assert.equal(draft.rationale, t("draft.screen.rationale", { role: "Backend Engineer" }));
    assert.ok(draft.rationale.includes("Backend Engineer"), "the role must be interpolated, not swallowed by an ICU quote");
    assert.deepEqual(draft.strengths, [t("draft.screen.strengthStack"), t("draft.screen.strengthSeniority")]);
    // next-intl returns the KEY PATH for a message it cannot find — a non-empty
    // string that would sail past an "is it truthy" assertion.
    assert.ok(!draft.rationale.includes("draft.screen"), "a missing key must fail here, not ship as its own path");
  });

  test(`${locale}: the offer draft renders from the ${locale} catalog and keeps the band`, () => {
    const t = translator(locale);
    const draft = buildSimOfferDraft(t, {
      role: "Backend Engineer",
      candidate: "Jana Nová",
      currency: "CZK",
      recommended: 90000,
      salaryMin: 80000,
      salaryMax: 100000,
    });
    assert.equal(draft.subject, t("draft.offer.subject", { role: "Backend Engineer" }));
    assert.equal(draft.body, t("draft.offer.body", { name: "Jana Nová", role: "Backend Engineer" }));
    assert.ok(draft.body.includes("Jana Nová"), "the candidate's name must be interpolated");
    assert.equal(draft.rationale, t("draft.offer.rationale"));
    assert.deepEqual([draft.recommended, draft.salaryMin, draft.salaryMax], [90000, 80000, 100000]);
  });
}

test("a missing role/candidate falls back to localized wording, never to an English literal", () => {
  const t = translator("cs");
  const screen = buildSimScreenDraft(t, "  ");
  assert.ok(screen.rationale.includes(t("draft.theRole")));
  const offer = buildSimOfferDraft(t, { role: null, candidate: null, currency: "CZK", recommended: 1, salaryMin: 1, salaryMax: 1 });
  assert.ok(offer.body.includes(t("draft.theCandidate")));
  assert.ok(offer.subject.includes(t("draft.theRole")));
});

test("the en draft is NOT what a cs reader gets — the whole point of the change", () => {
  const en = buildSimScreenDraft(translator("en"), "Backend Engineer");
  const cs = buildSimScreenDraft(translator("cs"), "Backend Engineer");
  assert.notEqual(cs.rationale, en.rationale);
  assert.notEqual(buildSimOfferDraft(translator("cs"), BAND).body, buildSimOfferDraft(translator("en"), BAND).body);
});

const BAND = { role: "Backend Engineer", candidate: "Jana", currency: "CZK", recommended: 1, salaryMin: 1, salaryMax: 1 };
