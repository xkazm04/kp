// Wire geometry (wireGeometry.ts): a wire leaves the card edge that faces the figure and ends mid-ring at the angle that
// faces the card (so it never crosses the figure), a stacked card gets none, threads bow toward the
// hub, and the hand note's arrow stops just short of what it points at.
//
// Runner: Node's built-in test runner with type stripping - npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { nearest, noteArrow, threadPath, wireFor, wirePath } from "./wireGeometry.ts";

const c = { x: 500, y: 300 };

test("wires leave the card edge that faces the figure and end mid-ring at the angle facing the card", () => {
  const left = wireFor({ left: 100, right: 300, top: 280, bottom: 320 }, c, [80, 120], 150);
  assert.deepEqual(left, { x1: 300, y1: 300, x2: 400, y2: 300 });
  const right = wireFor({ left: 700, right: 900, top: 80, bottom: 120 }, c, [80, 120], 150);
  assert.equal(right?.x1, 700);
  assert.ok(right && right.x2 > c.x && right.y2 < c.y, "upper right card, upper right end");
  assert.ok(right && Math.abs(Math.hypot(right.x2 - c.x, right.y2 - c.y) - 100) < 0.2, "on the ring's middle");
  assert.equal(wireFor({ left: 400, right: 600, top: 0, bottom: 40 }, c, [80, 120], 150), null, "a stacked card gets no wire");
  assert.equal(wirePath(left!), "M 300 300 C 350 300, 350 300, 400 300");
});

test("every wire ends outside the figure's hub and inside its rim, from any side", () => {
  for (const card of [{ left: 0, right: 120, top: 0, bottom: 40 }, { left: 880, right: 1000, top: 560, bottom: 600 }, { left: 0, right: 90, top: 500, bottom: 560 }]) {
    const w = wireFor(card, c, [60, 140], 150);
    assert.ok(w, JSON.stringify(card));
    const r = Math.hypot(w.x2 - c.x, w.y2 - c.y);
    assert.ok(r > 60 && r < 140, `mid-band, got ${r}`);
  }
});

test("threads bow toward the hub; nearest picks the closest point or none", () => {
  assert.match(threadPath({ x: 400, y: 300 }, { x: 520, y: 320 }, c), /^M 400 300 Q [\d.]+ [\d.]+ 520 320$/);
  assert.equal(threadPath({ x: 600, y: 300 }, { x: 600, y: 300 }, c), "M 600 300 Q 590 300 600 300", "the control point sits 10% toward the hub");
  assert.deepEqual(nearest({ x: 0, y: 0 }, [{ x: 5, y: 5 }, { x: 1, y: 1 }]), { x: 1, y: 1 });
  assert.equal(nearest({ x: 0, y: 0 }, []), null);
});

test("the note's arrow starts at the words and its head lands just short of the target", () => {
  const a = noteArrow({ x: 10, y: 20 }, { x: 200, y: 120 });
  assert.match(a.shaft, /^M 10 20 C /);
  assert.ok(a.shaft.endsWith("194 126"), "the shaft stops 6px short");
  assert.equal(a.head, "M 185 128 L 194 126 L 195 135");
});
