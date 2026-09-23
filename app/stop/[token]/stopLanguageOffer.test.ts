// The stop page's language offer — pure, so the page's one decision ("should we offer
// to switch this person's letters to the language they are reading this page in?") is
// testable without rendering a client component.
import { test } from "node:test";
import assert from "node:assert/strict";
import { otherLetterLocales, stopLanguageOffer } from "./stopLanguageOffer.ts";

test("a reader on an English page whose letters go out in Czech is offered English", () => {
  assert.deepEqual(stopLanguageOffer({ letterLocale: "cs", localeChosen: false }, "en"), { suggest: "en" });
});

test("no offer when the page is already in the letters' language", () => {
  assert.equal(stopLanguageOffer({ letterLocale: "cs", localeChosen: false }, "cs"), null);
});

test("no nag after a choice: a chosen language with an equal page language offers nothing", () => {
  assert.equal(stopLanguageOffer({ letterLocale: "en", localeChosen: true }, "en"), null);
});

test("after a choice the page never pushes the page language over it (a cookie is not a statement)", () => {
  assert.equal(stopLanguageOffer({ letterLocale: "en", localeChosen: true }, "cs"), null);
});

test("an unknown locale on either side offers nothing rather than a broken button", () => {
  assert.equal(stopLanguageOffer({ letterLocale: "xx", localeChosen: false }, "en"), null);
  assert.equal(stopLanguageOffer({ letterLocale: "cs", localeChosen: false }, "xx"), null);
});

test("the remaining choices exclude the current letter language and the one-click suggestion", () => {
  assert.deepEqual(otherLetterLocales("cs", "en"), ["de", "fr"]);
  assert.deepEqual(otherLetterLocales("cs", null), ["en", "de", "fr"]);
});
