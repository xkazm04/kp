// The Spark motion presets, tested as behaviour rather than as source shape.
//
// Before motion-presets.ts existed the /about illustrations obeyed reduced motion
// only because each of 22 motion elements hand-copied its end state twice and a
// ternary onto its transition, and AboutCurve.test.ts checked that by comparing
// ADJACENT SOURCE LINES. These cases pin the builder those elements now spread,
// plus the preview helpers that used to be unreachable from node:test because
// they lived in a "use client" .tsx.
//
// Runner: node:test with type stripping (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DRAW, ENTER, INSTANT, entrance, pop, reveal, stamp } from "./motion-presets.ts";
import * as aboutShared from "./about-art/shared.ts";

const final = { opacity: 1, x: 0 };
const init = { opacity: 0, x: -12 };
const tr = { delay: 0.2 };

test("reveal('inView') replays in view and writes the end state once", () => {
  assert.deepEqual(reveal("inView", false, final, tr, init), {
    initial: { opacity: 0, x: -12 },
    whileInView: { opacity: 1, x: 0 },
    animate: undefined,
    viewport: { once: false, amount: 0.5 },
    transition: { delay: 0.2 }
  });
});

test("reveal('inView') for a still reader lands on the end state, gating the transition, never the initial", () => {
  const still = reveal("inView", true, final, tr, init);
  const moving = reveal("inView", false, final, tr, init);
  assert.ok(still.animate !== undefined, "a still reader must be animated to the end state");
  assert.equal(still.animate, still.whileInView, "animate is the SAME end state as whileInView");
  assert.deepEqual(still.transition, { duration: 0 });
  assert.deepEqual(still.initial, moving.initial, "the initial style is what the server wrote; it must not branch");
});

test("reveal('mount') animates on mount with no viewport wiring", () => {
  const moving = reveal("mount", false, final, tr, init);
  assert.deepEqual(moving, { initial: init, animate: final, transition: tr });
  assert.ok(!("whileInView" in moving), "a mount reveal has no whileInView");
  assert.ok(!("viewport" in moving), "a mount reveal has no viewport");
  assert.deepEqual(reveal("mount", true, final, tr, init).transition, { duration: 0 });
});

test("pop/stamp gate the transition and keep the previews' choreography", () => {
  assert.deepEqual(pop(0.3, true).transition, { duration: 0 });
  assert.deepEqual(stamp(0.2, true).transition, { duration: 0 });
  assert.deepEqual(stamp(0.2, false).animate, { opacity: 1, scale: 1, rotate: -6 });
  assert.deepEqual(stamp(0.2, false).initial, { opacity: 0, scale: 2.2, rotate: 10 });
  assert.deepEqual(stamp(0.2, false).transition, { delay: 0.2, type: "spring", bounce: 0.45 });
  assert.deepEqual(pop(0.3, false), {
    initial: { opacity: 0, scale: 0.6, y: 14 },
    animate: { opacity: 1, scale: 1, y: 0 },
    transition: { delay: 0.3, type: "spring", bounce: 0.45 }
  });
  assert.deepEqual(INSTANT, { duration: 0 });
  assert.equal(entrance(true, { delay: 1 }), INSTANT);
  assert.deepEqual(entrance(false, { delay: 1 }), { delay: 1 });
});

test("about-art/shared.ts keeps exporting ENTER and DRAW from the one preset module", () => {
  assert.deepEqual(aboutShared.ENTER, { once: false, amount: 0.5 });
  assert.equal(aboutShared.ENTER, ENTER);
  assert.equal(aboutShared.DRAW, DRAW);
  assert.deepEqual(DRAW, { duration: 1, ease: [0.16, 1, 0.3, 1] });
});
