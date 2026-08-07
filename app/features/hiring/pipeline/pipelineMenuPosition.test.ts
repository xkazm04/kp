import { test } from "node:test";
import assert from "node:assert/strict";
import { clampMenuPosition } from "./pipelineMenuPosition.ts";

// The candidate context menu opens at the pointer, and a board row can sit anywhere —
// including hard against the right edge of a wide, horizontally-scrolled board or the
// bottom of a short window. Getting this wrong doesn't throw, it just renders the
// actions off-screen, so it is pinned here.

const VIEWPORT = { width: 1000, height: 800 };
const SIZE = { width: 224, height: 200 };

test("a menu with room stays exactly where the pointer was", () => {
  assert.deepEqual(clampMenuPosition({ x: 300, y: 400 }, SIZE, VIEWPORT), { x: 300, y: 400 });
});

test("a click near the right edge pulls the menu back inside", () => {
  const { x } = clampMenuPosition({ x: 960, y: 100 }, SIZE, VIEWPORT);
  assert.equal(x, 1000 - 224 - 8);
  assert.ok(x + SIZE.width <= VIEWPORT.width);
});

test("a click near the bottom edge pulls the menu up inside", () => {
  const { y } = clampMenuPosition({ x: 100, y: 780 }, SIZE, VIEWPORT);
  assert.equal(y, 800 - 200 - 8);
  assert.ok(y + SIZE.height <= VIEWPORT.height);
});

test("the viewport margin wins over the pointer at the top-left corner", () => {
  assert.deepEqual(clampMenuPosition({ x: 0, y: 0 }, SIZE, VIEWPORT), { x: 8, y: 8 });
});

test("a menu taller than the viewport pins to the margin instead of going off the top", () => {
  const tall = { width: 224, height: 1200 };
  assert.deepEqual(clampMenuPosition({ x: 500, y: 400 }, tall, VIEWPORT), { x: 500, y: 8 });
});
