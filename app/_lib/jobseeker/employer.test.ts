import assert from "node:assert/strict";
import { test } from "node:test";
import { employerName } from "./employer.ts";

test("a stand-in where the employer goes is no employer", () => {
  for (const s of ["siehe Beschreibung", "Siehe Beschreibung.", "(siehe Stellenbeschreibung)", "- see description -", "Confidential", "k. A.", "N/A", "viz popis", "Voir la description", "zie omschrijving", "patrz opis"]) {
    assert.equal(employerName(s), null, s);
  }
});

test("a real employer is kept as named, and an empty one is null", () => {
  assert.equal(employerName("  FERCHAU GmbH Niederlassung Rosenheim "), "FERCHAU GmbH Niederlassung Rosenheim");
  assert.equal(employerName("Beschreibung GmbH"), "Beschreibung GmbH", "only a whole stand-in, never a word of a name");
  assert.equal(employerName("Anonymous Robotics s.r.o."), "Anonymous Robotics s.r.o.");
  assert.equal(employerName(""), null);
  assert.equal(employerName("   "), null);
  assert.equal(employerName(null), null);
  assert.equal(employerName(undefined), null);
});
