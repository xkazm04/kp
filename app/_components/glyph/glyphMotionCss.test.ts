// The `prefers-reduced-motion` contract of the /motionize preset library.
//
// `MotionPreset.reduced` was declared, documented ("cross-fade only, or don't run
// at all") and never read: `MotionizedGlyph` hardcoded ONE reduced-motion answer
// — the cross-fade — for every preset, so a preset asking for `none` still faded
// in. The field was a comment. These tests are what make it a contract, and they
// run on the derivation rather than on a render, so they stay cheap.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { glyphMotionCss } from "./glyphMotionCss.ts";
import { AMBIENT_PRESETS, ENTRANCE_PRESETS, type MotionPreset } from "./motionPresets.ts";

const CLS = "mz-test";

/** The `@media (prefers-reduced-motion: reduce)` body, which is the whole subject. */
function reducedBlock(css: string): string {
  const at = css.indexOf("@media (prefers-reduced-motion: reduce) {");
  assert.notEqual(at, -1, "no reduced-motion media block was emitted at all");
  return css.slice(at);
}

/** A preset that declares stillness. Nothing in the shipped library does yet — the
 *  point of honouring the field is that adding one is a data change, not a code one. */
const STILL: MotionPreset = {
  kind: "entrance",
  keyframes: "from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); }",
  durationS: 0.5,
  ease: "linear",
  stagger: (d, s) => d * s,
  iteration: 1,
  reduced: "none",
};

test("self-check: the shipped presets are the shapes these tests reason about", () => {
  assert.ok(Object.keys(ENTRANCE_PRESETS).length >= 2);
  assert.ok(Object.keys(AMBIENT_PRESETS).length >= 2);
  // Every ambient loop in the library asks to be dropped outright; every entrance
  // asks for the cross-fade. If that ever stops being true the assertions below
  // still hold, but the coverage they give changes — so state it.
  assert.ok(Object.values(AMBIENT_PRESETS).every((p) => p.reduced === "none"));
  assert.ok(Object.values(ENTRANCE_PRESETS).every((p) => p.reduced === "opacity-only"));
});

test("an `opacity-only` entrance cross-fades under reduced motion", () => {
  for (const [name, entrance] of Object.entries(ENTRANCE_PRESETS)) {
    const block = reducedBlock(glyphMotionCss({ cls: CLS, entrance }));
    assert.match(block, new RegExp(`\\.${CLS}-el \\{ animation: ${CLS}-fade `), `${name}: no cross-fade`);
    assert.doesNotMatch(block, new RegExp(`${CLS}-in`), `${name}: the full entrance still runs`);
  }
});

test("a `none` entrance runs NO animation and stays visible", () => {
  const block = reducedBlock(glyphMotionCss({ cls: CLS, entrance: STILL }));
  assert.match(block, new RegExp(`\\.${CLS}-el \\{ animation: none;`));
  // The resting state is opacity 0, so "no animation" without this is an invisible glyph.
  assert.match(block, /animation: none; opacity: 1;/);
  assert.doesNotMatch(block, new RegExp(`${CLS}-fade`), "a preset asking for stillness still faded in");
});

test("an ambient loop declaring `reduced: none` is dropped, not merely re-timed", () => {
  const entrance = ENTRANCE_PRESETS["staggered-draw"]!;
  for (const [name, ambient] of Object.entries(AMBIENT_PRESETS)) {
    const block = reducedBlock(glyphMotionCss({ cls: CLS, entrance, ambient }));
    assert.match(block, new RegExp(`\\.${CLS}-amb \\{ animation: ${CLS}-fade [^;]*; \\}`), `${name}: not dropped`);
    // The loop keyframes must not be referenced anywhere under the media query.
    assert.doesNotMatch(block, new RegExp(`animation:[^;]*${CLS}-amb `), `${name}: the loop still runs`);
  }
});

test("an ambient loop declaring `opacity-only` keeps running under reduced motion", () => {
  const entrance = ENTRANCE_PRESETS["staggered-draw"]!;
  const ambient: MotionPreset = { ...AMBIENT_PRESETS.pulse, reduced: "opacity-only" };
  const block = reducedBlock(glyphMotionCss({ cls: CLS, entrance, ambient }));
  assert.match(block, new RegExp(`\\.${CLS}-amb \\{ animation: ${CLS}-fade [^;]*, ${CLS}-amb `));
});

test("outside the media query the declared motion is unchanged", () => {
  const entrance = ENTRANCE_PRESETS["staggered-draw"]!;
  const css = glyphMotionCss({ cls: CLS, entrance, ambient: AMBIENT_PRESETS.float });
  const full = css.slice(0, css.indexOf("@media"));
  assert.match(full, new RegExp(`\\.${CLS}-el \\{ animation: ${CLS}-in 0.5s`));
  // Two comma-separated animations: the entrance, then the loop that follows it.
  assert.match(full, new RegExp(`\\.${CLS}-amb \\{ animation: ${CLS}-in [^;]*, ${CLS}-amb [^;]*infinite alternate forwards; \\}`));
});
