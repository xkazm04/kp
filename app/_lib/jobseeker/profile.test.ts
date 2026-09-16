import test from "node:test";
import assert from "node:assert/strict";
import { mergePreferences, parsePreferences, parsePreferencesPatch, parseSalaryFloor } from "./profile.ts";
import { EMPTY_PREFERENCES } from "./types.ts";

// The boundary every preference payload crosses. Two facts are load-bearing: a
// salary floor without its currency is NOT a floor (no conversion anywhere), and a
// merge never lets an unsent or empty field erase what the seeker stated before.

test("a salary floor needs amount > 0, a 3-letter currency and a known period", () => {
  assert.deepEqual(parseSalaryFloor({ amount: 60000, currency: "czk", period: "month" }), { amount: 60000, currency: "CZK", period: "month" });
  assert.equal(parseSalaryFloor({ amount: 60000, period: "month" }), null, "no currency → not a floor");
  assert.equal(parseSalaryFloor({ amount: 0, currency: "CZK", period: "month" }), null);
  assert.equal(parseSalaryFloor({ amount: 60000, currency: "CZK", period: "week" }), null);
  assert.equal(parseSalaryFloor({ amount: "60000", currency: "CZK", period: "month" }), null);
  assert.equal(parseSalaryFloor(undefined), undefined, "not sent is not the same as cleared");
  assert.equal(parseSalaryFloor(null), null);
});

test("unknown fields and malformed members are dropped, never repaired", () => {
  const patch = parsePreferencesPatch({
    locations: ["Praha", " Brno ", "Praha", 42, ""],
    countries: ["CZ", "de", "Germany", "x"],
    workModes: ["remote", "office", "remote", "hybrid"],
    seniority: "principal",
    targetTitles: ["Backend Engineer"],
    deepDive: { threshold: 250, maxPerScan: -3 },
    evil: "payload",
  });
  assert.deepEqual(patch.locations, ["Praha", "Brno"]);
  assert.deepEqual(patch.countries, ["cz", "de"]);
  assert.deepEqual(patch.workModes, ["remote", "hybrid"]);
  assert.equal(patch.seniority, null);
  assert.deepEqual(patch.deepDive, { threshold: 100, maxPerScan: 0 });
  assert.equal("evil" in patch, false);
  assert.equal("salaryFloor" in patch, false, "a field the payload never carried is absent from the patch");
});

test("the full read always yields a complete, valid record", () => {
  assert.deepEqual(parsePreferences(undefined), EMPTY_PREFERENCES);
  assert.deepEqual(parsePreferences("junk"), EMPTY_PREFERENCES);
  const full = parsePreferences({ targetTitles: ["Data Engineer"], salaryFloor: { amount: 3000, currency: "EUR", period: "month" } });
  assert.deepEqual(full.targetTitles, ["Data Engineer"]);
  assert.deepEqual(full.salaryFloor, { amount: 3000, currency: "EUR", period: "month" });
  assert.deepEqual(full.deepDive, EMPTY_PREFERENCES.deepDive);
});

test("merge: unsent and empty members never erase a stated value; an explicit null does", () => {
  const base = { ...EMPTY_PREFERENCES, locations: ["Praha"], salaryFloor: { amount: 1, currency: "CZK", period: "month" as const } };
  const merged = mergePreferences(base, { locations: [], targetTitles: ["Dev"], salaryFloor: undefined });
  assert.deepEqual(merged.locations, ["Praha"], "an empty list from a later turn keeps the stated places");
  assert.deepEqual(merged.targetTitles, ["Dev"]);
  assert.deepEqual(merged.salaryFloor, base.salaryFloor);
  assert.equal(mergePreferences(base, { salaryFloor: null }).salaryFloor, null, "clearing is an explicit null");
});
