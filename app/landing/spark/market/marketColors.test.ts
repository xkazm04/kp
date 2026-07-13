// Locks the Market Pulse colour-scale contract (landing-marketing finding #3):
// `JdCard` coloured its sector label with `familyColor(item.orgType)`, but org
// keys are never in `FAMILY_ORDER`, so `indexOf` → -1, the `Math.max(0, …)` clamp
// forced index 0, and EVERY card rendered `FAMILY_COLORS[0]` = CORAL regardless of
// sector (and CORAL means "private" in `OrgSplit`). These tests pin that:
//   • familyColor keys by taxonomy position (and, tellingly, clamps an unknown
//     key to CORAL — the exact trap the org bug fell into), and
//   • orgColor is a SEPARATE, distinct-per-sector scale — private/public/agency
//     are three different hues, so a public card is no longer coral.
//
// Non-vacuity: pointing orgColor at the old resolution (`familyColor(org)`) makes
// the "distinct + public===STEEL" assertions fail — verified by a temporary swap.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { familyColor, orgColor, FAMILY_COLORS } from "./marketColors.ts";
import { FAMILY_ORDER, type FamilyKey, type OrgKey } from "./data.ts";
import { CORAL, MOSS, AMBER, STEEL } from "../tokens.ts";

test("orgColor gives each sector a DISTINCT hue (private/public/agency)", () => {
  assert.equal(orgColor("private"), CORAL);
  assert.equal(orgColor("public"), STEEL);
  assert.equal(orgColor("agency"), AMBER);
  // The bug's essence: they must not collapse to one colour.
  assert.notEqual(orgColor("public"), orgColor("private"));
  assert.notEqual(orgColor("agency"), orgColor("private"));
  assert.equal(new Set(["private", "public", "agency"].map((o) => orgColor(o as OrgKey))).size, 3);
});

test("a public card is NOT coral — coral is reserved for the private sector", () => {
  // Pre-fix regression this pins: public sector rendered CORAL (= private).
  assert.notEqual(orgColor("public"), CORAL);
});

test("familyColor documents the trap: an org key would clamp to CORAL (index 0)", () => {
  // Why the old `familyColor(item.orgType)` was silently all-coral — an org key
  // isn't in FAMILY_ORDER, so indexOf → -1 → Math.max(0,…) → FAMILY_COLORS[0].
  for (const org of ["private", "public", "agency"] as OrgKey[]) {
    assert.equal(familyColor(org as unknown as FamilyKey), CORAL);
  }
  assert.equal(familyColor("not_a_family" as unknown as FamilyKey), CORAL);
});

test("familyColor keys a real family by taxonomy position, cycling the 4 colours", () => {
  const cycle = [CORAL, MOSS, AMBER, STEEL];
  assert.deepEqual(FAMILY_COLORS, cycle);
  FAMILY_ORDER.forEach((fam, i) => {
    assert.equal(familyColor(fam), cycle[i % cycle.length]);
  });
});
