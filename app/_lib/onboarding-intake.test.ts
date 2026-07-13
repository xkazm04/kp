// Pure coverage for the pre-boarding intake guard (bug-ui-scan-2026-07-09 offers-onboarding #2):
// only allowed non-blank string answers survive, and an all-blank payload is recognised as
// "no submission" so it can be refused before an intake row is ever written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanIntakeAnswers, hasAnyIntakeAnswer } from "./onboarding-intake.ts";

const ALLOWED = ["preferredName", "tshirtSize", "emergencyContact"];

test("cleanIntakeAnswers keeps only allowed, non-blank string answers", () => {
  const clean = cleanIntakeAnswers(
    {
      preferredName: "Alex",
      tshirtSize: "   ", // whitespace-only → dropped
      emergencyContact: "", // empty → dropped
      dietaryNeeds: "vegan", // not in this template → dropped
      startDateConfirm: 42 as unknown as string, // non-string → dropped
    },
    ALLOWED
  );
  assert.deepEqual(clean, { preferredName: "Alex" });
});

test("cleanIntakeAnswers returns an EMPTY object for an all-blank payload (the reminder-killing case)", () => {
  assert.deepEqual(cleanIntakeAnswers({}, ALLOWED), {});
  assert.deepEqual(cleanIntakeAnswers({ preferredName: "  ", tshirtSize: "" }, ALLOWED), {});
  // Non-allowed keys with content are still nothing to persist.
  assert.deepEqual(cleanIntakeAnswers({ notAField: "x" }, ALLOWED), {});
});

test("hasAnyIntakeAnswer is false for blank/whitespace and true once one field has content", () => {
  assert.equal(hasAnyIntakeAnswer({}), false);
  assert.equal(hasAnyIntakeAnswer({ a: "", b: "   " }), false);
  assert.equal(hasAnyIntakeAnswer({ a: undefined, b: null }), false);
  assert.equal(hasAnyIntakeAnswer({ a: "", b: "Alex" }), true);
});
