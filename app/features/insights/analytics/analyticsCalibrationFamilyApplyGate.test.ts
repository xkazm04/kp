// Guards the calibration recommendation's APPLY contract at the source level (there
// is no render/DOM test layer in this repo — see file-intake-gate.test.ts for the
// idiom this follows).
//
// HISTORY: the per-family recommendation used to be INERT — the screening floor was
// a single global knob, so /apply-threshold re-derived from unfiltered pairs and any
// family-scoped apply would 409. The panel worked around it by rendering the family
// view as informational (a "switch to all families" cue) instead of an Apply button.
//
// family-floors made the floor per-family-capable, so the family view's Apply now
// comes ALIVE: it writes that family's BOUNDED override, re-derived server-side
// against the SAME family's live pairs (the 409 staleness guard stays honest). This
// file pins the new contract: the suggestion is appliable in BOTH scopes and threads
// the family scope to the write; the informational dead-end is gone.
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

// feature-structure-refactor — CalibrationPanel.tsx was split into several
// cohesive modules (each under the 200-line cap): AnalyticsCalibrationPanel.tsx
// (orchestration + family-floor read + the ThresholdSuggestion call site),
// AnalyticsThresholdSuggestion.tsx (the apply POST) and AnalyticsFamilyFloorChips.tsx
// (the override chips). The contract this file guards now spans all three, so it
// reads and concatenates them rather than one file.
const src = [
  read("./AnalyticsCalibrationPanel.tsx"),
  read("./AnalyticsThresholdSuggestion.tsx"),
  read("./AnalyticsFamilyFloorChips.tsx"),
].join("\n");

test("the recommendation threads the current family scope to the apply", () => {
  // ThresholdSuggestion receives roleFamily={family}: "" on the all-families view
  // (moves the global floor), a family slug under a filter (writes that family's
  // override). If this scope stops being threaded, a family apply would silently
  // move the global knob again.
  assert.match(
    src,
    /roleFamily=\{family\}/,
    'ThresholdSuggestion must receive roleFamily={family} so the apply is scoped to the shown view',
  );
});

test("the apply POST includes roleFamily only when a family is selected", () => {
  // The write body threads the family conditionally: a global apply posts no
  // roleFamily (byte-identical to before), a family apply posts its slug so the route
  // writes familyFloors[family] and re-derives the 409 guard against that scope.
  assert.match(
    src,
    /\.\.\.\(roleFamily \? \{ roleFamily \} : \{\}\)/,
    'the apply POST must spread roleFamily only when set',
  );
});

test("the dead-end informational card is gone — no view-all-families escape hatch", () => {
  // The old family-view fallback (recViewAllFamilies + onViewAllFamilies) existed only
  // because a family apply could not succeed. It must not return: a family apply is now
  // a first-class, appliable action.
  assert.doesNotMatch(src, /onViewAllFamilies/, "the view-all-families dead-end affordance must be gone");
  assert.doesNotMatch(src, /appliable=\{/, "there is no longer an appliable gate — both scopes can apply");
});

test("families carrying an override are surfaced as drill-in chips", () => {
  // family-floors: the panel chips each family that carries its own floor, showing the
  // value and drilling into that family (setFamily) to review/adjust it.
  assert.match(src, /data\.familyFloors/, "the panel must read the familyFloors map from the payload");
  assert.match(src, /t\("familyFloorValue"/, "each override chip must show its floor value");
  assert.match(src, /onClick=\{\(\)\s*=>\s*setFamily\(fam\)\}/, "an override chip must drill into its family");
});
