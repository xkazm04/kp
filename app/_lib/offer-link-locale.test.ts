import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// perfect: offer-door-speaks-the-letter-language (2026-09-01). The offer letter is
// composed in the candidate's locale, but the accept/decline link inside it was
// built bare — while the status, erasure and schedule links beside it all pin
// ?lang= (proxy.ts turns it back into the NEXT_LOCALE cookie). A Czech candidate
// opened an English page on the single highest-stakes moment in the product.
//
// Source-contract test (the repo pattern for wiring that unit-level calls can't
// reach without booting the comms stack): the pin must happen INSIDE the two
// dispatchers, right beside the `candidateLocale(...)` resolution the letter itself
// uses — never re-derived by a caller from a different source — and the page must
// carry the shared LanguageSwitcher as its escape hatch, like the status page.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

test("the offer letter and the offer reminder both pin the link to the letter's locale", () => {
  const src = read("comms-dispatch.ts");
  const offerAt = src.indexOf("export async function dispatchOffer(");
  const reminderAt = src.indexOf("export async function dispatchOfferReminder(");
  assert.ok(offerAt > 0 && reminderAt > 0, "both dispatchers must exist");
  const offerBody = src.slice(offerAt, src.indexOf("\n}\n", offerAt));
  const reminderBody = src.slice(reminderAt, src.indexOf("\n}\n", reminderAt));
  for (const [name, body] of [["dispatchOffer", offerBody], ["dispatchOfferReminder", reminderBody]] as const) {
    assert.match(body, /candidateLocale\(entry\.locale, entry\.workspaceId\)/, `${name} resolves the letter's locale`);
    assert.match(body, /pinLinkLocale\([A-Za-z]+, locale\)/, `${name} pins the link to THAT locale`);
    assert.doesNotMatch(body, /\{ link: (responseLink|link) \}/, `${name} must not hand the catalog the unpinned link`);
  }
});

test("the offer page gives the candidate a way back to their own language", () => {
  const src = read("../offer/[token]/OfferClient.tsx");
  assert.match(src, /LanguageSwitcher/, "the offer page renders the shared LanguageSwitcher, like the status page");
});
