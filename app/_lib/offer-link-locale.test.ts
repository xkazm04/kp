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
  const composeAt = src.indexOf("export function composeOfferLetter(");
  assert.ok(composeAt > 0, "the offer letter has ONE composer, shared by the send and the preview");
  const offerBody = src.slice(offerAt, src.indexOf("\n}\n", offerAt));
  const reminderBody = src.slice(reminderAt, src.indexOf("\n}\n", reminderAt));
  const composeBody = src.slice(composeAt, src.indexOf("\n}\n", composeAt));
  // dispatchOffer resolves the locale and hands it, with the raw link, to the composer,
  // which does the pinning (challenge-r06 comms-dispatch-relay/B): the pin is asserted
  // where it now lives, and neither body may hand the catalog an unpinned link.
  assert.match(offerBody, /candidateLocale\(entry\.locale, entry\.workspaceId\)/, "dispatchOffer resolves the letter's locale");
  assert.match(offerBody, /composeOfferLetter\([\s\S]*link: responseLink,[\s\S]*locale,/, "dispatchOffer composes with THAT locale");
  assert.match(composeBody, /pinLinkLocale\(opts\.link, locale\)/, "composeOfferLetter pins the link to the letter's locale");
  assert.match(reminderBody, /candidateLocale\(entry\.locale, entry\.workspaceId\)/, "dispatchOfferReminder resolves the letter's locale");
  assert.match(reminderBody, /pinLinkLocale\([A-Za-z]+, locale\)/, "dispatchOfferReminder pins the link to THAT locale");
  for (const [name, body] of [["dispatchOffer", offerBody], ["dispatchOfferReminder", reminderBody], ["composeOfferLetter", composeBody]] as const) {
    assert.doesNotMatch(body, /\{ link: (responseLink|opts\.link) \}/, `${name} must not hand the catalog the unpinned link`);
  }
});

test("the offer page gives the candidate a way back to their own language", () => {
  // The offer door's markup is the kit letter (Gate 2); its public bar carries the switcher.
  const src = read("../offer/[token]/kit/OfferKitView.tsx");
  assert.match(src, /LanguageSwitcher/, "the offer page renders the shared LanguageSwitcher, like the status page");
});
