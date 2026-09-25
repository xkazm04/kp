// The acquisition filters every feed adapter applies locally, BEFORE the matcher sees a
// posting. They are hard filters — a posting they drop is never scored — so they must
// never be stricter than the matcher downstream: a stated-remote posting is location-ok
// there (pipeline/jobfit/matching.py), a posting in a country the seeker named is a
// market they asked for, and a role-family slug is a ranking signal, not title text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PREFERENCES, type JobseekerPreferences } from "../types.ts";
import { matchesLocations, matchesTargets } from "./shared.ts";

const prefs = (over: Partial<JobseekerPreferences>): JobseekerPreferences => ({ ...EMPTY_PREFERENCES, ...over });
const at = (location: string | null, country: string | null = null, workMode: "remote" | "hybrid" | "onsite" | null = null) => ({ location, country, workMode });

test("matchesLocations: no named places lets everything through", () => {
  assert.equal(matchesLocations(at("Dresden", "de"), prefs({})), true);
});

test("matchesLocations: an unknown location is never a penalty", () => {
  assert.equal(matchesLocations(at(null), prefs({ locations: ["Praha"] })), true);
});

test("matchesLocations: the city matches folded (case and diacritics)", () => {
  assert.equal(matchesLocations(at("Praha 5 - Smíchov", "cz"), prefs({ locations: ["praha"] })), true);
  assert.equal(matchesLocations(at("Plzeň"), prefs({ locations: ["Plzen"] })), true);
});

test("matchesLocations: another city in a country the seeker did not name is dropped", () => {
  assert.equal(matchesLocations(at("Ostrava", "cz"), prefs({ locations: ["Praha"] })), false);
  assert.equal(matchesLocations(at("Dresden", "de"), prefs({ locations: ["Praha"], countries: ["cz"] })), false);
});

test("matchesLocations: a posting in a country the seeker named passes whatever the city", () => {
  assert.equal(matchesLocations(at("Dresden", "de"), prefs({ locations: ["Praha"], countries: ["cz", "de"] })), true);
  assert.equal(matchesLocations(at("Dresden", " DE "), prefs({ locations: ["Praha"], countries: ["de"] })), true, "the posting's country is normalized to ISO-2 lower");
  assert.equal(matchesLocations(at("Dresden", "DE"), prefs({ locations: ["Praha"], countries: ["De"] })), true, "so are the seeker's");
});

test("matchesLocations: a stated-remote posting passes when the seeker named no work mode or named remote", () => {
  assert.equal(matchesLocations(at("Berlin", "de", "remote"), prefs({ locations: ["Praha"] })), true);
  assert.equal(matchesLocations(at("Berlin", "de", "remote"), prefs({ locations: ["Praha"], workModes: ["remote", "hybrid"] })), true);
});

test("matchesLocations: remote does not open the door for a seeker who ruled remote out", () => {
  assert.equal(matchesLocations(at("Berlin", "de", "remote"), prefs({ locations: ["Praha"], workModes: ["onsite"] })), false);
});

test("matchesLocations: hybrid is not remote — a hybrid role elsewhere is still elsewhere", () => {
  assert.equal(matchesLocations(at("Berlin", "de", "hybrid"), prefs({ locations: ["Praha"] })), false);
});

test("matchesTargets: no titles lets everything through", () => {
  assert.equal(matchesTargets("Řidič", prefs({})), true);
});

test("matchesTargets: a title matches as whole words, folded", () => {
  assert.equal(matchesTargets("Senior AI Engineer (LLM)", prefs({ targetTitles: ["AI Engineer"] })), true);
  assert.equal(matchesTargets("Java programátor", prefs({ targetTitles: ["java"] })), true);
  assert.equal(matchesTargets("Vývojář backendu", prefs({ targetTitles: ["vyvojar"] })), true);
});

test("matchesTargets: a needle inside a longer word is not a match", () => {
  assert.equal(matchesTargets("JavaScript developer", prefs({ targetTitles: ["Java"] })), false);
  assert.equal(matchesTargets("Maintenance technician", prefs({ targetTitles: ["AI"] })), false);
});

test("matchesTargets: any one of several titles is enough", () => {
  assert.equal(matchesTargets("Data Engineer", prefs({ targetTitles: ["AI Engineer", "Data Engineer"] })), true);
  assert.equal(matchesTargets("Accountant", prefs({ targetTitles: ["AI Engineer", "Data Engineer"] })), false);
});

test("matchesTargets: role-family slugs alone never discard a title — the matcher ranks", () => {
  assert.equal(matchesTargets("Senior AI Engineer (LLM)", prefs({ targetRoleFamilies: ["software_engineering"] })), true);
  assert.equal(matchesTargets("Accountant", prefs({ targetRoleFamilies: ["software_engineering"] })), true);
});

test("matchesTargets: with titles set, a family slug is not read as title text", () => {
  // Under the old filter "data_science" became the needle "data science" and let this through.
  assert.equal(matchesTargets("Data Science Intern", prefs({ targetTitles: ["AI Engineer"], targetRoleFamilies: ["data_science"] })), false);
});
