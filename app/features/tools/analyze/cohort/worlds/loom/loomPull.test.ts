import { test } from "node:test";
import assert from "node:assert/strict";
import { FULL_CLIP, PULL, flipTransform, lineClip, rowBand, swapFrames } from "./loomPull.ts";

test("the row band spans n columns centred on the first and last knots", () => {
  const band = rowBand({ left: 100, top: 300, width: 30, height: 32 }, { left: 480, top: 300, width: 30, height: 32 }, 20, 316, 40);
  // centres 115 .. 495 over 19 gaps = 20px pitch
  assert.equal(band.width, 400);
  assert.equal(band.left, 105);
  assert.equal(band.top, 296);
  assert.equal(band.height, 40);
  assert.equal(rowBand({ left: 0, top: 0, width: 30, height: 30 }, { left: 0, top: 0, width: 30, height: 30 }, 1, 15, 30).width, 30);
});

test("the flip lays the page's row over the loom's row (origin left centre)", () => {
  const to = { left: 200, top: 100, width: 800, height: 40 };
  const from = { left: 260, top: 500, width: 600, height: 40 };
  assert.equal(flipTransform(from, to), "translate(60px, 400px) scale(0.75, 1)");
  assert.equal(flipTransform(to, to), "translate(0px, 0px) scale(1, 1)");
});

test("the line clip collapses a layer to its row, clamped to the layer", () => {
  assert.equal(lineClip(120, 900), "inset(120px 0px 780px 0px)");
  assert.equal(lineClip(-10, 900), "inset(0px 0px 900px 0px)");
  assert.equal(lineClip(1000, 900), "inset(900px 0px 0px 0px)");
  assert.equal(FULL_CLIP, "inset(0px 0px 0px 0px)");
});

test("reduced motion drops the geometry; every transition ends before the settle timer", () => {
  assert.deepEqual(swapFrames(1, true), [{ opacity: 0 }, { opacity: 1 }]);
  assert.match(String(swapFrames(-1, false)[0].transform), /translateY\(-18px\)/);
  assert.ok(PULL.openDelay + PULL.openMs + PULL.fadeMs < PULL.maxMs);
  assert.ok(PULL.closeMs + PULL.returnMs < PULL.maxMs);
});
