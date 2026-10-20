import { test } from "node:test";
import assert from "node:assert/strict";
import { tooltipPosition } from "./tooltip-position.ts";

const trigger = { left: 100, right: 140, top: 100, bottom: 124 };
const tip = { width: 80, height: 30 };
const viewport = { width: 320, height: 240 };

test("tooltip positions each side next to the trigger", () => {
  assert.deepEqual(tooltipPosition(trigger, tip, "top", viewport), { left: 80, top: 64 });
  assert.deepEqual(tooltipPosition(trigger, tip, "bottom", viewport), { left: 80, top: 130 });
  assert.deepEqual(tooltipPosition(trigger, tip, "left", viewport), { left: 14, top: 97 });
  assert.deepEqual(tooltipPosition(trigger, tip, "right", viewport), { left: 146, top: 97 });
});

test("tooltip stays within the viewport near a clipped edge", () => {
  assert.deepEqual(tooltipPosition({ left: 0, right: 20, top: 0, bottom: 20 }, tip, "top", viewport), { left: 8, top: 8 });
  assert.deepEqual(tooltipPosition({ left: 300, right: 320, top: 220, bottom: 240 }, tip, "bottom", viewport), { left: 232, top: 202 });
});
