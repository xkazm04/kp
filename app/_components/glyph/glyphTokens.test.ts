// Locks the /motionize hex→token snap. The whole dual-theme guarantee rests on it:
// if a traced accent snaps to a structural token, the glyph greys out in Studio
// Light and goes muddy in Spark Dark, and no per-theme override exists to save it.
// The hexes below are real VTracer output from the pipeline's first traced glyph.
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { snapToToken } from "./glyphTokens.ts";

test("generator pastels snap by hue, not by RGB distance", () => {
  // Sage/terracotta come back lighter than the brand hexes; nearest-RGB would send
  // every one of these to --color-dial-stone.
  for (const sage of ["#7F9475", "#89A17E", "#8BA27F"]) {
    assert.deepEqual(snapToToken(sage), { paint: "var(--color-moss)", accent: true });
  }
  for (const terracotta of ["#DD815E", "#DF805D"]) {
    assert.deepEqual(snapToToken(terracotta), { paint: "var(--color-coral)", accent: true });
  }
});

test("brand hexes snap to their own token", () => {
  assert.equal(snapToToken("#d65a4a").paint, "var(--color-coral)");
  assert.equal(snapToToken("#526b4f").paint, "var(--color-moss)");
  assert.equal(snapToToken("#42606f").paint, "var(--color-steel)");
  assert.equal(snapToToken("#caa54c").paint, "var(--color-dial-amber)");
});

test("structural regions resolve by role and never animate", () => {
  assert.deepEqual(snapToToken("#0A0302"), { paint: "var(--color-ink)", accent: false }); // traced ink
  assert.deepEqual(snapToToken("#fdf8ee"), { paint: "var(--color-paper)", accent: false }); // ground
  assert.deepEqual(snapToToken("#8c8779"), { paint: "var(--color-dial-stone)", accent: false }); // muted
  assert.deepEqual(snapToToken("#dce7d0"), { paint: "var(--color-limewash)", accent: false }); // pale tint
});

test("tracer-emitted tokens pass through untouched", () => {
  assert.deepEqual(snapToToken("var(--color-paper)"), { paint: "var(--color-paper)", accent: false });
});
