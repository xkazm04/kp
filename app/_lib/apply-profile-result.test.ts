// Pins the TS↔Python trust boundary for conversational apply (idea-c1d8ef1f).
// profile_cli's stdout used to be trusted purely by a TypeScript cast, so an
// exit-0 CLI returning `{}`, `{profile:null}`, or a partial object either threw a
// cryptic "Cannot read properties of undefined (reading 'roleFamily')" — surfaced
// to recruiters as the degraded reason — or persisted a junk profile. These tests
// lock the runtime check that converts that drift into a clear reason and refuses
// to save malformed payloads.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { validateProfileCliResult } from "./apply-profile-result.ts";

const VALID = { profile: { roleFamily: "engineering", skills: [] }, archetype: "bau", completeness: 0.8 };

test("accepts a well-formed profile_cli result and returns the typed fields", () => {
  const r = validateProfileCliResult(VALID);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value.profile, VALID.profile);
    assert.equal(r.value.archetype, "bau");
    assert.equal(r.value.completeness, 0.8);
  }
});

test("accepts a profile with no roleFamily (the route falls back to the job's)", () => {
  const r = validateProfileCliResult({ profile: {}, archetype: "student", completeness: 0 });
  assert.equal(r.ok, true, "an empty profile object is structurally valid; roleFamily is optional");
});

test("THE BUG: an empty object {} is rejected with a clear reason, not a TypeError", () => {
  const r = validateProfileCliResult({});
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /no profile object/);
});

test("{ profile: null } is rejected (the dereference that used to throw)", () => {
  const r = validateProfileCliResult({ profile: null, archetype: "bau", completeness: 1 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /no profile object.*null/);
});

test("a profile that is an array (not an object) is rejected", () => {
  const r = validateProfileCliResult({ profile: [], archetype: "bau", completeness: 1 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /no profile object.*array/);
});

test("top-level non-objects are rejected (null, array, scalar)", () => {
  for (const bad of [null, undefined, [], "ok", 42, true]) {
    const r = validateProfileCliResult(bad);
    assert.equal(r.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
    if (!r.ok) assert.match(r.reason, /expected an object/);
  }
});

test("a missing archetype is rejected (partial object would otherwise persist junk)", () => {
  const r = validateProfileCliResult({ profile: {}, completeness: 0.5 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /non-string archetype.*absent/);
});

test("a non-string archetype is rejected", () => {
  const r = validateProfileCliResult({ profile: {}, archetype: 7, completeness: 0.5 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /non-string archetype/);
});

test("an empty/blank archetype is rejected — it slips past the route's ?? FALLBACK guard", () => {
  for (const blank of ["", "   "]) {
    const r = validateProfileCliResult({ profile: {}, archetype: blank, completeness: 0.5 });
    assert.equal(r.ok, false, `expected archetype ${JSON.stringify(blank)} to be rejected`);
    if (!r.ok) assert.match(r.reason, /empty archetype/);
  }
});

test("a non-numeric or non-finite completeness is rejected", () => {
  for (const bad of [undefined, "0.5", null, NaN, Infinity]) {
    const r = validateProfileCliResult({ profile: {}, archetype: "bau", completeness: bad });
    assert.equal(r.ok, false, `expected completeness ${String(bad)} to be rejected`);
    if (!r.ok) assert.match(r.reason, /non-numeric completeness/);
  }
});

test("completeness of exactly 0 is accepted (a real low score, not missing)", () => {
  const r = validateProfileCliResult({ profile: {}, archetype: "bau", completeness: 0 });
  assert.equal(r.ok, true);
});

test("every failure reason is a non-empty single-line string (safe as a degraded reason)", () => {
  for (const bad of [{}, { profile: null }, { profile: {}, archetype: 1, completeness: 1 }]) {
    const r = validateProfileCliResult(bad);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.reason.length > 0, "reason is non-empty");
      assert.doesNotMatch(r.reason, /\n/, "reason is single-line");
    }
  }
});
