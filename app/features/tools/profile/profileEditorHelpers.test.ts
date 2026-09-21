// Inline field validation: a hidden graduation typo must not disable Save, and a
// visible one still must. validateProfileEditorFields already gated yearsError on
// fieldVis.years; expectedGraduation was validated even after the input unmounted.
//
// Runner: Node's built-in test runner with type stripping. npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProfileEditorFields } from "./profileEditorHelpers.ts";

const t = ((key: string) => key) as Parameters<typeof validateProfileEditorFields>[0];

test("invalid hidden graduation does not block Save", () => {
  const r = validateProfileEditorFields(t, { years: true, graduation: false }, "5", "20266");
  assert.equal(r.gradError, undefined);
  assert.equal(r.hasFieldErrors, false);
});

test("visible invalid graduation still blocks Save", () => {
  const r = validateProfileEditorFields(t, { years: false, graduation: true }, "", "20266");
  assert.equal(r.gradError, "gradError");
  assert.equal(r.hasFieldErrors, true);
});

test("valid visible graduation does not block Save", () => {
  const r = validateProfileEditorFields(t, { years: false, graduation: true }, "", "2026");
  assert.equal(r.gradError, undefined);
  assert.equal(r.hasFieldErrors, false);
});
