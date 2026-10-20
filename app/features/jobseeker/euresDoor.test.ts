// The two EURES doors (the feed's one-click button and the Sources card) share ONE
// country derivation, so the sentence either door shows is the query the scan sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { euresCountryPlan, scanningSourceName } from "./euresDoor.ts";

test("euresCountryPlan: no country set defaults to cz and says it will be written", () => {
  assert.deepEqual(euresCountryPlan([]), { countries: ["cz"], defaulted: true, label: "CZ" });
  assert.deepEqual(euresCountryPlan(undefined), { countries: ["cz"], defaulted: true, label: "CZ" });
  assert.deepEqual(euresCountryPlan(["  "]), { countries: ["cz"], defaulted: true, label: "CZ" });
});

test("euresCountryPlan: named countries are normalized, deduplicated and never overwritten", () => {
  assert.deepEqual(euresCountryPlan(["DE", " de ", "at"]), { countries: ["de", "at"], defaulted: false, label: "DE, AT" });
});

const catalog = [
  { host: "europa.eu", label: "EURES (European Labour Authority)" },
  { host: "recruitee.com", label: "Recruitee careers site API (per company)" },
];

test("scanningSourceName: the host the scan is reading resolves to the catalog's short name", () => {
  assert.equal(scanningSourceName(catalog, "europa.eu"), "EURES");
  assert.equal(scanningSourceName(catalog, "acme.recruitee.com"), "Recruitee careers site API", "a per-company host resolves to its vendor");
});

test("scanningSourceName: an uncatalogued host is named by the host itself", () => {
  assert.equal(scanningSourceName(catalog, "jobs.example.org"), "jobs.example.org");
});

test("scanningSourceName: a phase code or nothing is not a source", () => {
  for (const msg of ["structure", "match", "deep-dive", "done", "aborted", "no_profile", null, "", "  "]) {
    assert.equal(scanningSourceName(catalog, msg), null, String(msg));
  }
});
