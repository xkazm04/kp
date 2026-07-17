// Pins the hydration contract. idea-1e8b9e1f stopped edit/duplicate from inventing
// languages / seniority / education the candidate never declared; idea-fa7d5360
// extends that honesty to the BLANK CREATE form too. The form used to pre-fill
// bachelor / "Czech, English" / junior on create, and build() submitted them, so an
// empty intake silently satisfied the education_known / has_languages (/ bau's
// has_seniority) completeness checks — inflating a recruiter-facing score with
// values nobody chose. Hydration is now identical for create and edit: an absent
// field maps to an honest neutral, so completeness reflects real input.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { hydrate, archetypeFieldVisibility, archetypeScopedProfileFields } from "./ProfileForm.ts";
import type { ProfilePayload } from "./ProfileTypes.ts";

test("blank create form starts honest — no unchosen education/languages/seniority", () => {
  // idea-fa7d5360: pre-filled defaults must not inflate completeness, so a blank
  // intake reflects real input. roleFamily seeds the honest neutral (candidate-profile
  // -job-matching #2): the matcher scores roleFamily, so a blank form must NOT default
  // to software_engineering and bias every non-tech profile toward SWE roles.
  const f = hydrate(null);
  assert.equal(f.roleFamily, "general_professional", "blank form seeds the neutral family, not software_engineering");
  assert.equal(f.educationLevel, "unknown");
  assert.equal(f.seniority, "");
  assert.equal(f.languages, "");
  assert.equal(f.choice, "auto");
});

test("editing a profile with no languages does NOT seed 'Czech, English'", () => {
  // The normalized payload serializes absent languages as an empty array.
  const payload: ProfilePayload = { displayName: "Jana", languages: [], educationLevel: "unknown" };
  const f = hydrate(payload);
  assert.equal(f.languages, "");
});

test("editing a profile with no seniority does NOT seed 'junior'", () => {
  // seniority is optional and dropped from the payload when unset (exclude_none).
  const payload: ProfilePayload = { displayName: "Petr", archetype: "bau" };
  const f = hydrate(payload);
  assert.equal(f.seniority, "");
});

test("an unset education level stays the honest 'unknown', not 'bachelor'", () => {
  const f = hydrate({ displayName: "Eva" });
  assert.equal(f.educationLevel, "unknown");
});

test("a stored profile round-trips its declared values faithfully", () => {
  const payload: ProfilePayload = {
    displayName: "Lucie",
    archetype: "bau",
    roleFamily: "data_ai",
    educationLevel: "master",
    languages: ["French", "German"],
    seniority: "senior",
    yearsExperience: 6,
    aspirations: ["ML engineer"],
  };
  const f = hydrate(payload);
  assert.equal(f.choice, "bau");
  assert.equal(f.roleFamily, "data_ai");
  assert.equal(f.educationLevel, "master");
  assert.equal(f.languages, "French, German");
  assert.equal(f.seniority, "senior");
  assert.equal(f.yearsExperience, "6");
  assert.equal(f.aspirations, "ML engineer");
});

test("declared language/seniority always win over the honest neutral fallbacks", () => {
  const f = hydrate({ languages: ["Slovak"], seniority: "lead" });
  assert.equal(f.languages, "Slovak");
  assert.equal(f.seniority, "lead");
});

// idea-7ac9e45f: the archetype-switch contract. Years/seniority useState persists
// across a switch, but the value is submitted STRICTLY by visibility — so a field the
// form hid for the selected archetype is never persisted, and what is saved always
// matches what is on screen. archetypeFieldVisibility is the single source both the
// inputs' render conditions and build()'s submission read from.

test("archetypeFieldVisibility exposes years for bau/career_switcher, seniority for bau only", () => {
  assert.deepEqual(archetypeFieldVisibility("bau"), { years: true, seniority: true });
  assert.deepEqual(archetypeFieldVisibility("career_switcher"), { years: true, seniority: false });
  assert.deepEqual(archetypeFieldVisibility("student"), { years: false, seniority: false });
  assert.deepEqual(archetypeFieldVisibility("auto"), { years: false, seniority: false });
});

test("bau submits both years and seniority", () => {
  assert.deepEqual(archetypeScopedProfileFields("bau", "6", "senior"), {
    yearsExperience: 6,
    seniority: "senior",
  });
});

test("switching career_switcher→student drops the now-hidden years (the core bug)", () => {
  // Years was entered as a career-switcher, then the archetype flipped to student.
  // The string still lingers in state, but student hides the field, so nothing leaks.
  assert.deepEqual(archetypeScopedProfileFields("student", "6", ""), {});
});

test("switching bau→career_switcher does NOT submit the now-hidden seniority", () => {
  // Seniority was picked as bau, then the archetype flipped to career_switcher, which
  // shows years but not seniority. Years still submits; the hidden seniority does not.
  assert.deepEqual(archetypeScopedProfileFields("career_switcher", "3", "senior"), {
    yearsExperience: 3,
  });
});

test("empty years/seniority are omitted even when their field is visible", () => {
  assert.deepEqual(archetypeScopedProfileFields("bau", "", ""), {});
  assert.deepEqual(archetypeScopedProfileFields("bau", "  ", ""), {});
});

test("auto-detect submits neither years nor seniority regardless of retained state", () => {
  assert.deepEqual(archetypeScopedProfileFields("auto", "9", "lead"), {});
});
