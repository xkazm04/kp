import { test } from "node:test";
import assert from "node:assert/strict";
import { wipeFrames, wipeOrigin, wipeRadius } from "./wipe.ts";

test("the origin is the touched element's centre in the layer's own box", () => {
  assert.deepEqual(wipeOrigin({ left: 100, top: 50, width: 800, height: 600 }, { left: 300, top: 250, width: 40, height: 20 }), { x: 220, y: 210 });
});

test("without an element the wipe opens from the top centre, never off the first screen", () => {
  assert.deepEqual(wipeOrigin({ left: 0, top: 0, width: 1000, height: 3000 }, null), { x: 500, y: 160 });
  assert.deepEqual(wipeOrigin({ left: 0, top: 0, width: 400, height: 200 }, null), { x: 200, y: 100 });
});

test("the radius reaches the farthest corner from anywhere, including a point outside the box", () => {
  const box = { width: 1000, height: 600 };
  for (const pt of [{ x: 0, y: 0 }, { x: 1000, y: 600 }, { x: 500, y: 300 }, { x: 980, y: 20 }, { x: -50, y: 700 }]) {
    const r = wipeRadius(pt, box);
    for (const c of [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 600 }, { x: 1000, y: 600 }]) {
      assert.ok(Math.hypot(c.x - pt.x, c.y - pt.y) < r, `corner ${c.x},${c.y} from ${pt.x},${pt.y}`);
    }
  }
});

test("open grows from nothing to the covering circle, close is the same circle reversed", () => {
  const [a, b] = wipeFrames({ x: 10.4, y: 20.6 }, { width: 100, height: 100 }, "open");
  assert.equal(a, "circle(0px at 10px 21px)");
  assert.match(b, /^circle\(\d+px at 10px 21px\)$/);
  assert.deepEqual(wipeFrames({ x: 10.4, y: 20.6 }, { width: 100, height: 100 }, "close"), [b, a]);
});
