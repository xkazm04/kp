import test from "node:test";
import assert from "node:assert/strict";
import { APP_CURRENCY } from "./format";
import { currencySymbol, isOrgCurrency, resolveOrgCurrency, withCurrency } from "./org-settings";

// The organization's salary currency: a LABEL the map board prints beside bands,
// never a conversion. These pin the two things a reader actually sees.

test("an unset or unknown stored currency falls back to the app default", () => {
  assert.equal(resolveOrgCurrency(null), APP_CURRENCY);
  assert.equal(resolveOrgCurrency(""), APP_CURRENCY);
  assert.equal(resolveOrgCurrency("XYZ"), APP_CURRENCY);
  assert.equal(resolveOrgCurrency(" eur "), "EUR");
  assert.equal(isOrgCurrency("USD"), true);
  assert.equal(isOrgCurrency("usd"), false);
});

test("the koruna is Kč in Czech only, its ISO code everywhere else (ruling 2026-09-14)", () => {
  assert.equal(currencySymbol("CZK", "cs"), "Kč");
  assert.equal(currencySymbol("CZK", "en"), "CZK");
  assert.equal(currencySymbol("CZK", "de"), "CZK");
  assert.equal(currencySymbol("EUR", "cs"), "EUR");
});

test("English puts the code first, the other locales after — never wrapping apart", () => {
  assert.equal(withCurrency("45–50k", "CZK", "en"), "CZK 45–50k");
  assert.equal(withCurrency("45–50k", "CZK", "cs"), "45–50k Kč");
  assert.equal(withCurrency("4,5k", "EUR", "fr"), "4,5k EUR");
});
