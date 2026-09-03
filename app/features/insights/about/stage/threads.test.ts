// Connector geometry for the deck's register: a claim on one side, its evidence
// on the other, a drawn thread between them.
//
// The failure this file guards is specific and it is the one that makes a
// diagram read as BROKEN rather than as alive: a thread that ends somewhere
// other than the edge of the box it claims to come from. Everything here is
// pure and derived from the same percent rects the boxes are drawn from, so
// that failure is checkable without a browser.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { bottomOf, bowFor, leftOf, rightOf, sCurve, topOf, vCurve } from "./threads.ts";
import type { Rect } from "./stages.ts";

const BOX: Rect = { x: 10, y: 20, w: 30, h: 40 };

/** The four numbers an SVG cubic carries: start point, then the end point. */
function ends(d: string): { from: [number, number]; to: [number, number] } {
  const m = d.match(/^M (-?[\d.]+) (-?[\d.]+) C .*, (-?[\d.]+) (-?[\d.]+)$/);
  assert.ok(m, `not a single-cubic path: ${d}`);
  return { from: [Number(m[1]), Number(m[2])], to: [Number(m[3]), Number(m[4])] };
}

test("anchors sit on the edge of the rect they are taken from", () => {
  assert.deepEqual(rightOf(BOX), { x: 40, y: 40 }, "right edge, vertically centred");
  assert.deepEqual(leftOf(BOX), { x: 10, y: 40 }, "left edge, vertically centred");
  assert.deepEqual(bottomOf(BOX), { x: 25, y: 60 }, "bottom edge, centred by default");
  assert.deepEqual(topOf(BOX), { x: 25, y: 20 });
  assert.deepEqual(bottomOf(BOX, 0.25), { x: 17.5, y: 60 }, "a fraction moves the anchor across the edge");
  assert.deepEqual(topOf(BOX, 1), { x: 40, y: 20 }, "1 is the far corner, not an overflow");
});

test("a curve starts and ends exactly on its anchors", () => {
  // The whole contract. A curve that drifts off its anchor is the one bug that
  // makes the reader distrust the picture rather than the product.
  const a = { x: 5, y: 10 };
  const b = { x: 80, y: 65 };
  for (const d of [sCurve(a, b), sCurve(a, b, 0.2), vCurve(a, b), vCurve(a, b, 0.9)]) {
    const { from, to } = ends(d);
    assert.deepEqual(from, [5, 10], d);
    assert.deepEqual(to, [80, 65], d);
  }
});

test("a thread drawn between two real rects lands on both boxes", () => {
  const src: Rect = { x: 0, y: 4, w: 30, h: 22 };
  const dst: Rect = { x: 46, y: 4, w: 54, h: 10.5 };
  const { from, to } = ends(sCurve(rightOf(src), leftOf(dst), bowFor(0)));
  assert.deepEqual(from, [30, 15], "leaves the source's right edge");
  assert.deepEqual(to, [46, 9.25], "meets the row's left edge");
});

test("vCurve keeps a curvature floor so adjacent drops stay distinguishable", () => {
  // Two stages a hair apart would otherwise both flatten into the same straight
  // line, and a funnel drawn out of identical straight lines stops reading as a
  // funnel.
  const near = vCurve({ x: 50, y: 50 }, { x: 50, y: 51 });
  const control = near.match(/C (-?[\d.]+) (-?[\d.]+)/);
  assert.ok(control);
  assert.ok(
    Number(control[2]) - 50 >= 3.9,
    `MIN_RUN did not apply: the first control point is only ${Number(control[2]) - 50} below the start`
  );
});

test("the per-index wobble is deterministic and cycles", () => {
  // It must NOT be random: these scenes re-render every 900ms and a Math.random
  // here would make every thread twitch on each tick.
  assert.equal(bowFor(0), bowFor(0));
  assert.equal(bowFor(0), bowFor(7), "the wobble table wraps rather than running off its end");
  assert.notEqual(bowFor(0), bowFor(1), "adjacent threads get visibly different bows");
  for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 20]) {
    const bow = bowFor(i);
    assert.ok(bow > 0.4 && bow < 0.7, `bowFor(${i}) = ${bow} is outside the range that still reads as a routed line`);
  }
});

test("the path memo returns the same string for the same inputs, and a different one otherwise", () => {
  // The cache is keyed on RAW inputs precisely because `r2` is applied to
  // intermediate control points: two starts that round alike can still produce
  // different curves, so a rounded key would serve one scene another's thread.
  const a = { x: 1.004, y: 2 };
  const to = { x: 50, y: 60 };

  assert.equal(sCurve(a, to), sCurve(a, to), "a repeat call is indistinguishable from the first");
  assert.equal(sCurve(a, to, 0.3), sCurve(a, to, 0.3));
  assert.notEqual(sCurve(a, to, 0.3), sCurve(a, to, 0.6), "the bow is part of the key");
  assert.notEqual(sCurve(a, to), vCurve(a, to), "the two curve kinds never collide in the cache");
  assert.notEqual(sCurve(a, to), sCurve(a, { x: 51, y: 60 }), "the endpoint is part of the key");
  assert.notEqual(sCurve(a, to), sCurve({ x: 2, y: 2 }, to), "the start point is part of the key");
});
