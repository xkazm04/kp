// Key parity for the JS theme forks. design:check already pins every literal
// to globals.css; this file pins that a useTheme() fork cannot read LIGHT.MOSS
// and find no DARK.MOSS, which is how a chart paints Studio Light onto #141b24.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { DARK, LIGHT } from "./brand.ts";

const NAMED_HUES = ["INK", "PAPER", "MOSS", "CORAL", "STEEL", "LIMEWASH", "DIAL_STONE", "DIAL_AMBER"] as const;

test("every named brand hue exists on DARK", () => {
  for (const key of NAMED_HUES) {
    assert.equal(key in DARK, true, `DARK.${key} is missing — a useTheme() fork would import the light constant`);
    assert.match((DARK as Record<string, string>)[key], /^#[0-9a-f]{6}$/i);
  }
});

test("every LIGHT role key exists on DARK", () => {
  for (const key of Object.keys(LIGHT)) {
    assert.equal(key in DARK, true, `LIGHT.${key} has no DARK twin`);
  }
});
