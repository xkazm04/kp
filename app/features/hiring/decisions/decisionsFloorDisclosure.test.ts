import { test } from "node:test";
import assert from "node:assert/strict";
import {
  familyFloorEntries,
  familyFloorSummaryList,
  rowEffectiveFloor,
  familyOverrideRejectCount,
} from "./decisionsFloorDisclosure.ts";

const upper = (s: string) => s.toUpperCase();

test("familyFloorEntries drops no-op overrides equal to the global floor and sorts by slug", () => {
  const entries = familyFloorEntries(
    { legal_compliance: 60, software_engineering: 55, hr_people: 45 },
    45, // hr_people override equals the global → a no-op, omitted
    upper
  );
  assert.deepEqual(
    entries,
    [
      { family: "legal_compliance", label: "LEGAL_COMPLIANCE", floor: 60 },
      { family: "software_engineering", label: "SOFTWARE_ENGINEERING", floor: 55 },
    ],
    "only differing overrides survive, sorted by slug, labelled via labelFor"
  );
});

test("familyFloorEntries is empty for absent / null maps", () => {
  assert.deepEqual(familyFloorEntries(undefined, 45, upper), []);
  assert.deepEqual(familyFloorEntries(null, 45, upper), []);
  assert.deepEqual(familyFloorEntries({}, 45, upper), []);
});

test("familyFloorSummaryList renders 'label value' joined by commas", () => {
  const list = familyFloorSummaryList([
    { family: "software_engineering", label: "Software", floor: 55 },
    { family: "legal_compliance", label: "Legal / Compliance", floor: 60 },
  ]);
  assert.equal(list, "Software 55, Legal / Compliance 60");
});

test("rowEffectiveFloor reads a numeric threshold, else null", () => {
  assert.equal(rowEffectiveFloor({ threshold: 55 }), 55);
  assert.equal(rowEffectiveFloor({ threshold: 0 }), 0);
  assert.equal(rowEffectiveFloor({}), null);
  assert.equal(rowEffectiveFloor(undefined), null);
  assert.equal(rowEffectiveFloor({ threshold: "x" as unknown as number }), null);
});

test("familyOverrideRejectCount counts reject rows whose floor differs from the slider", () => {
  const decisions: { action: string; reasonParams?: Record<string, string | number> }[] = [
    { action: "reject", reasonParams: { threshold: 55 } }, // engineering override → counted
    { action: "reject", reasonParams: { threshold: 45 } }, // equals slider → not an override
    { action: "reject", reasonParams: { threshold: 60 } }, // legal override → counted
    { action: "keep", reasonParams: { threshold: 55 } }, // keeps never count
    { action: "reject", reasonParams: {} }, // no threshold → not counted
  ];
  assert.equal(familyOverrideRejectCount(decisions, 45), 2);
  assert.equal(familyOverrideRejectCount(decisions, 55), 2); // 45 & 60 now differ from a 55 slider
  assert.equal(familyOverrideRejectCount([], 45), 0);
});
