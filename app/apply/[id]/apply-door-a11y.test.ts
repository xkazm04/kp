import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Accessibility + design-system guards for the PUBLIC apply door — the one
// surface in this app whose users are strangers on their own phones, with no
// support channel and no second attempt.
//
// Three properties, each of which was live and each of which a restyle silently
// re-breaks:
//   (a) the transcript's auto-scroll and the quick form's jump-to-field were
//       unconditional smooth scrolls, although useReducedMotion has existed for
//       the JS-driven animations elsewhere;
//   (b) the inline validation messages were adjacent role="alert" paragraphs
//       with nothing tying them to the input they were about — a screen-reader
//       user landing on the field heard no reason;
//   (c) the buttons hand-rolled the class strings recipes.ts exports, so the
//       public door drifted from the app's own dual-theme button treatment.
// Source-contract tests — the repo pattern for wiring the unit runner's DOM-less
// environment cannot reach (see candidate-door-conversion.test.ts).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");

test("no scroll on the apply door is unconditionally smooth", () => {
  for (const rel of ["ConversationalApply.tsx", "quick/QuickApplyForm.tsx"]) {
    const src = read(rel);
    assert.match(src, /useReducedMotion\(\)/, `${rel} must read the motion preference`);
    assert.doesNotMatch(
      src,
      /behavior: "smooth"/,
      `${rel} still hardcodes a smooth scroll — it must resolve through reducedMotion`
    );
    assert.match(src, /behavior: reducedMotion \? "auto" : "smooth"/, `${rel} scrolls per the reader's preference`);
  }
});

test("every inline field error is ASSOCIATED with the control it is about", () => {
  const controls = read("ApplyStepControls.tsx");
  // The text step: the message's id is the input's aria-describedby, and the
  // invalid state is on the input itself (TextInput maps `invalid` to aria-invalid).
  assert.match(controls, /const errorId = `apply-step-error-\$\{step\.id\}`/);
  assert.match(controls, /aria-describedby=\{stepError \? errorId : cvPrefilled \? hintId : undefined\}/);
  assert.match(controls, /invalid=\{Boolean\(stepError\)\}/);
  assert.match(controls, /<p id=\{errorId\} role="alert"/);
  // The file step's own failure, on the input that produced it.
  assert.match(controls, /aria-invalid=\{uploadErr \? true : undefined\}/);
  assert.match(controls, /aria-describedby=\{uploadErr \? uploadErrorId : undefined\}/);
  assert.match(controls, /<p id=\{uploadErrorId\} role="alert"/);

  const quick = read("quick/QuickApplyForm.tsx");
  assert.match(quick, /aria-describedby=\{emailError \? "qa-email-error" : "qa-email-hint"\}/);
  assert.match(quick, /<p id="qa-email-error" role="alert"/);
  assert.match(quick, /<p id="qa-email-hint"/);
  // The submit button answers for the form-level alerts it raised.
  assert.match(quick, /aria-describedby=\{submitError \? "qa-submit-error" : incompleteError \? "qa-incomplete-error" : undefined\}/);
});

test("the door's buttons compose the shared recipes instead of re-typing them", () => {
  for (const rel of ["ApplyStepControls.tsx", "ApplyDoneCard.tsx", "ApplyErrorBlock.tsx", "quick/QuickApplyForm.tsx"]) {
    const src = read(rel);
    assert.match(src, /from "@\/app\/_components\/ui\/recipes"/, `${rel} must import the button recipes`);
    // The hand-rolled primaries these replaced, byte for byte.
    assert.doesNotMatch(src, /bg-ink px-4 py-2 text-base font-semibold text-white hover:bg-steel/, `${rel} hand-rolls the primary button`);
    assert.doesNotMatch(src, /rounded-md border border-stone-200 bg-white px-\d/, `${rel} hand-rolls the secondary button`);
  }
});
