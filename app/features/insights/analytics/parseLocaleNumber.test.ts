// The defect this pins: a German operator correcting a channel's spend to 12.000
// silently stored 12. `Number("12.000")` is 12, and the editor handed it straight
// through — a wrong write on a money path that feeds cost-per-applicant,
// cost-per-hire and the metric pack a buyer reads. `en` was safe only by accident
// (`Number("12,000")` is NaN, a visible refusal), which is why the asymmetry went
// unnoticed.
//
// Runner: Node's built-in test runner with type stripping — npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocaleNumber } from "./parseLocaleNumber.ts";

test("the same keystrokes mean different numbers in different locales", () => {
  // "twelve thousand", written the way each catalog groups it.
  assert.equal(parseLocaleNumber("12,000", "en"), 12000);
  assert.equal(parseLocaleNumber("12.000", "de"), 12000); // was silently 12
  assert.equal(parseLocaleNumber("12 000", "cs"), 12000);
  assert.equal(parseLocaleNumber("12 000", "fr"), 12000);
  // …and "twelve point five", likewise.
  assert.equal(parseLocaleNumber("12.5", "en"), 12.5);
  assert.equal(parseLocaleNumber("12,5", "de"), 12.5);
  assert.equal(parseLocaleNumber("12,5", "cs"), 12.5);
  assert.equal(parseLocaleNumber("12,5", "fr"), 12.5);
});

test("the ambiguous input is resolved by the locale, never by a guess", () => {
  // The whole reason this needs the locale: one string, two correct answers.
  assert.equal(parseLocaleNumber("1.234", "en"), 1.234);
  assert.equal(parseLocaleNumber("1.234", "de"), 1234);
  assert.equal(parseLocaleNumber("1,234", "en"), 1234);
  assert.equal(parseLocaleNumber("1,234", "de"), 1.234);
});

test("every kind of group space is dropped, including the ones formatGrouped emits", () => {
  // cs groups with U+00A0 and fr with U+202F, so an operator typing back the number
  // on screen was handing Number() a NaN before the space strip existed.
  assert.equal(parseLocaleNumber("12\u00a0000", "cs"), 12000);
  assert.equal(parseLocaleNumber("12\u202f000", "fr"), 12000);
  assert.equal(parseLocaleNumber(" 5000 ", "en"), 5000);
  assert.equal(parseLocaleNumber("1 234 567", "cs"), 1234567);
});

test("blank is 'no value'; junk is a VISIBLE refusal, never a coercion", () => {
  // null is the editors' "clear this field"; NaN fails their Number.isFinite guard.
  assert.equal(parseLocaleNumber("", "en"), null);
  assert.equal(parseLocaleNumber("   ", "en"), null);
  for (const junk of ["abc", "12px", "1.2.3", "--5", "1e5"]) {
    const v = parseLocaleNumber(junk, "en");
    assert.ok(v != null && Number.isNaN(v), `${junk} must refuse visibly, got ${v}`);
  }
  // A refusal in one locale is not a licence to coerce in another.
  assert.ok(Number.isNaN(parseLocaleNumber("1.2.3", "en") as number));
});

test("group separators are REMOVED, not validated for position", () => {
  // Grouping carries no value information — the digit sequence is the number — so
  // sloppy grouping is accepted rather than refused. Every spreadsheet does the
  // same, and refusing "12,00,0" would turn a typo into a wall for a figure whose
  // digits are unambiguous. Only a second DECIMAL separator is genuinely ambiguous,
  // and that still refuses (above).
  assert.equal(parseLocaleNumber("12,00,0", "en"), 12000);
  assert.equal(parseLocaleNumber("1.2.3", "de"), 123);
});

test("plain integers and zero behave in every locale", () => {
  for (const loc of ["en", "de", "cs", "fr"]) {
    assert.equal(parseLocaleNumber("0", loc), 0, loc);
    assert.equal(parseLocaleNumber("007", loc), 7, loc);
    assert.equal(parseLocaleNumber("18000", loc), 18000, loc);
    assert.equal(parseLocaleNumber("-5", loc), -5, loc);
  }
});
