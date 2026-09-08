import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INTAKE_COAT,
  DEFAULT_PROMOTE_OPTIONS,
  INTAKE_COAT_IDS,
  coatEditable,
  isIntakeCoatId,
} from "./coatKit";
import type { IntakeSession } from "../jdsIntakeLogic";

// The coat vocabulary is a closed set with a runtime door, and the door is what a
// stored preference passes through: `localStorage` is user-writable and survives a
// coat being deleted, so a stale id must land on the default rather than render a
// coat that no longer exists.

test("the guard accepts every declared coat and nothing else", () => {
  for (const id of INTAKE_COAT_IDS) assert.equal(isIntakeCoatId(id), true, id);
  for (const junk of ["", "CLASSIC", "atelier ", "brutalist", null, undefined]) {
    assert.equal(isIntakeCoatId(junk as string | null | undefined), false, String(junk));
  }
});

test("the default coat is the baseline, so a first open changes nothing", () => {
  // The prototype's whole value is the comparison: if a new direction were the
  // default, nobody would ever see the thing being compared against.
  assert.equal(DEFAULT_INTAKE_COAT, "classic");
  assert.equal(isIntakeCoatId(DEFAULT_INTAKE_COAT), true);
});

test("the promote defaults a coat swap must not change", () => {
  // The captioned checkboxes and the glyph toggles buy the same thing: the
  // work-sample case is opt-IN, the salary read is opt-OUT. A coat is paint; it
  // may never change what a click costs.
  assert.deepEqual(DEFAULT_PROMOTE_OPTIONS, { caseDesign: false, marketResearch: true });
});

test("only an open session is editable — complete and promoted are not", () => {
  const at = (status: IntakeSession["status"]) => coatEditable({ status } as IntakeSession);
  assert.equal(at("open"), true);
  assert.equal(at("complete"), false);
  assert.equal(at("promoted"), false);
});
