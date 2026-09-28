import { test } from "node:test";
import assert from "node:assert/strict";
import type { JobseekerPreferences } from "@/app/_lib/jobseeker/types";
import { addToken, changedFields, countryCodeOf, payDraftOf, payFloorOf, restatePeriod, wantSetCount } from "./wantModel";

const PREFS: JobseekerPreferences = {
  locations: ["Praha"],
  countries: ["cz"],
  workModes: ["remote"],
  salaryFloor: { amount: 80000, currency: "CZK", period: "month" },
  targetRoleFamilies: [],
  targetTitles: ["AI Engineer"],
  languages: [],
  seniority: null,
  deepDive: { threshold: 65, maxPerScan: 10 },
};

test("a pay draft holds a currency with no amount, and an amount with no currency, until Done", () => {
  // The defect this shape replaced: either half alone saved "no floor" and snapped back.
  const empty = payDraftOf(null);
  assert.deepEqual(empty, { amount: 0, currency: null, period: "month" });
  const currencyFirst = { ...empty, currency: "EUR" };
  assert.deepEqual(payFloorOf(currencyFirst), { floor: null }, "0 is no floor, whatever the currency");
  assert.deepEqual(payFloorOf({ ...currencyFirst, amount: 5000 }), { floor: { amount: 5000, currency: "EUR", period: "month" } });
  // An amount with no currency is refused with a reason, never stored as no floor silently.
  assert.deepEqual(payFloorOf({ ...empty, amount: 5000 }), { error: "noCurrency" });
});

test("restating the period restates the amount, x12 and back", () => {
  const d = payDraftOf(PREFS.salaryFloor);
  assert.deepEqual(restatePeriod(d, "year"), { amount: 960000, currency: "CZK", period: "year" });
  assert.deepEqual(restatePeriod(restatePeriod(d, "year"), "month"), d);
  assert.equal(restatePeriod(d, "month"), d);
});

test("Done sends only what the card changed", () => {
  assert.deepEqual(changedFields(PREFS, { locations: ["Praha"], countries: ["cz", "de"] }), { countries: ["cz", "de"] });
  assert.deepEqual(changedFields(PREFS, { salaryFloor: { amount: 80000, currency: "CZK", period: "month" } }), {});
  assert.deepEqual(changedFields(PREFS, { seniority: null }), {});
  assert.deepEqual(changedFields(PREFS, { seniority: "senior", workModes: [] }), { seniority: "senior", workModes: [] });
});

test("tokens and country codes", () => {
  assert.deepEqual(addToken(["Praha"], "  praha "), ["Praha"]);
  assert.deepEqual(addToken(["Praha"], "Brno"), ["Praha", "Brno"]);
  assert.deepEqual(addToken(["Praha"], "   "), ["Praha"]);
  assert.equal(countryCodeOf(" DE "), "de");
  assert.equal(countryCodeOf("deu"), null);
  assert.equal(wantSetCount(PREFS), 4);
});
