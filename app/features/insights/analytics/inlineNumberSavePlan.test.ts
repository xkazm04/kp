// The save decision behind every inline numeric editor on the analytics tab — the
// channel spend that cost-per-hire divides by, and the recruiter goals. It lived
// inside a `.tsx` and therefore had ZERO executable coverage: parseLocaleNumber has
// its own suite, but the three rules layered on top of it (zero means "no value",
// an unchanged value sends no request, the draft is re-seeded to what would actually
// be stored) were only ever exercised by hand.
//
// Runner: Node's built-in test runner with type stripping.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { planInlineSave } from "./inlineNumberSavePlan.ts";

test("a plain number in the reader's notation is saved and canonicalized", () => {
  assert.deepEqual(planInlineSave("5000", null, "en"), { kind: "save", value: 5000, canonical: "5000" });
  assert.deepEqual(planInlineSave("007", null, "en"), { kind: "save", value: 7, canonical: "7" });
  assert.deepEqual(planInlineSave(" 5000 ", null, "en"), { kind: "save", value: 5000, canonical: "5000" });
});

test("the separator is read in the READER's locale, not en-US", () => {
  // The defect this rule exists for: `Number("12.000")` is 12, so a German operator
  // typing 12.000 silently stored twelve crowns while an English one typing 12,000
  // failed visibly. Same string, two correct-and-different readings.
  assert.deepEqual(planInlineSave("12.000", null, "de"), { kind: "save", value: 12000, canonical: "12000" });
  assert.deepEqual(planInlineSave("12,000", null, "en"), { kind: "save", value: 12000, canonical: "12000" });
  // …and the decimal reading of the same shapes, each in the locale that owns it.
  assert.deepEqual(planInlineSave("1.5", null, "en"), { kind: "save", value: 1.5, canonical: "1.5" });
  assert.deepEqual(planInlineSave("1,5", null, "de"), { kind: "save", value: 1.5, canonical: "1.5" });
});

test("a typed zero is 'no value', and displays as one", () => {
  // Both stores DELETE the row on a non-positive amount and still answer 200, so the
  // editor must show what the column it feeds shows: an em-dash, i.e. an empty field.
  // Typing 0 over an already-empty field is a save-nothing, not a stored zero.
  assert.deepEqual(planInlineSave("0", 500, "en"), { kind: "save", value: null, canonical: "" });
  assert.deepEqual(planInlineSave("0", null, "en"), { kind: "unchanged", canonical: "" });
  assert.deepEqual(planInlineSave("", 500, "en"), { kind: "save", value: null, canonical: "" });
});

test("an unchanged value sends no request but still re-seeds the display", () => {
  assert.deepEqual(planInlineSave("5000", 5000, "en"), { kind: "unchanged", canonical: "5000" });
  // The re-seed is the load-bearing half: "5 000" is the same stored value, and the
  // field must settle on the canonical form rather than keep the typed one.
  assert.deepEqual(planInlineSave("5 000", 5000, "fr"), { kind: "unchanged", canonical: "5000" });
  assert.deepEqual(planInlineSave("", null, "en"), { kind: "unchanged", canonical: "" });
});

test("a negative or unparseable draft is refused, never written", () => {
  assert.deepEqual(planInlineSave("-1", 500, "en"), { kind: "invalid" });
  assert.deepEqual(planInlineSave("abc", 500, "en"), { kind: "invalid" });
  // A refusal must not be confusable with a clear: both would be `value: null`.
  assert.notEqual(planInlineSave("abc", 500, "en").kind, "save");
});
