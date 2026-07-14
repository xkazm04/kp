// Guards the family-scoped calibration recommendation appliability contract.
//
// Open defect (round 3): the calibration route derives the threshold suggestion
// from roleFamily-FILTERED pairs, but /apply-threshold re-derives from UNFILTERED
// (all-families) pairs. When a family is selected and its suggestion differs from
// the all-families one, the write guard fires a guaranteed 409 on an Apply button
// that can NEVER succeed. Semantically maxMatchToReject is a single GLOBAL floor,
// so a family-derived number targeting a global knob is wrong to apply anyway.
//
// The fix: the recommendation is appliable ONLY on the unfiltered (all-families)
// view; the family-filtered view shows it as informational with a one-click "switch
// to all families" cue. This pins that contract at the source level (there is no
// render/DOM test layer in this repo — see file-intake-gate.test.ts for the idiom).
//
// Runner: Node's built-in test runner with type stripping.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

const src = read("./CalibrationPanel.tsx");

test("appliability is bound to the all-families (unfiltered) view", () => {
  // The panel passes appliable={family === ""}: an apply flow only when no family
  // filter is active. If someone rebinds this to always-true, a family-scoped
  // number can be posted at the global floor again → the 409 dead-end returns.
  assert.match(
    src,
    /appliable=\{family === ""\}/,
    "ThresholdSuggestion must receive appliable={family === \"\"} — apply only on the all-families view",
  );
  // The cue is one-click: it switches the selector back to all families, where the
  // live apply lives.
  assert.match(
    src,
    /onViewAllFamilies=\{\(\)\s*=>\s*setFamily\(""\)\}/,
    "the switch-to-all-families affordance must reset the family selector to all",
  );
});

test("the Apply write is reachable only in the appliable (all-families) branch", () => {
  const gate = src.indexOf("appliable ?");
  const applyClick = src.indexOf("onClick={apply}");
  const cue = src.indexOf('t("recViewAllFamilies")');

  assert.ok(gate > 0, "the appliable ? gate must exist inside ThresholdSuggestion");
  assert.ok(applyClick > 0, "the Apply button (onClick={apply}) must exist");
  assert.ok(cue > 0, "the informational switch-to-all-families cue (recViewAllFamilies) must exist");

  // Structural pin: unfiltered view = apply present, family-filtered view = the cue
  // instead. The Apply affordance (which triggers the /apply-threshold write) sits
  // in the appliable-true branch, after the gate; the cue sits in the
  // appliable-false branch, after the Apply affordance. Reorder either out of its
  // branch and this fails — the whole point is that the write can't render under a
  // family filter.
  assert.ok(applyClick > gate, "the Apply button must live inside the appliable-true branch");
  assert.ok(cue > applyClick, "the family-filtered cue must live in the appliable-false branch, after Apply");
});
