import { test } from "node:test";
import assert from "node:assert/strict";
import { computePopoverPosition } from "./matrix-popover.ts";

// bug-ui-scan-2026-07-09 (skill-matrix-coverage #5).

test("a comfortably-placed cell anchors just below itself, unclamped", () => {
  const pos = computePopoverPosition({ left: 200, bottom: 100 }, { width: 1280, height: 800 });
  assert.deepEqual(pos, { top: 106, left: 200 }); // bottom + gap(6), left as-is
});

test("a cell near the right edge clamps left so the popover stays on-screen", () => {
  const pos = computePopoverPosition({ left: 1260, bottom: 100 }, { width: 1280, height: 800 });
  assert.equal(pos.left, 1280 - 320 - 8); // width 320, margin 8 → 952
});

test("a cell near the bottom clamps the top up so the popover isn't cut off below", () => {
  const pos = computePopoverPosition({ left: 100, bottom: 780 }, { width: 1280, height: 800 });
  assert.equal(pos.top, 800 - 340 - 8); // height 340, margin 8 → 452
});

test("a viewport too SHORT for the popover pins top to the margin — never negative", () => {
  // Pre-fix: Math.min(rect.bottom + 6, height - 340) = min(256, -40) = -40 → off the top
  // edge. Fix clamps the lower bound to margin (8).
  const pos = computePopoverPosition({ left: 50, bottom: 250 }, { width: 1024, height: 300 });
  assert.ok(pos.top >= 8, `top must never be negative on a short viewport, got ${pos.top}`);
  assert.equal(pos.top, 8);
});

test("left never goes below the margin on a narrow viewport", () => {
  const pos = computePopoverPosition({ left: 2, bottom: 40 }, { width: 200, height: 800 });
  assert.ok(pos.left >= 8, `left must respect the margin, got ${pos.left}`);
});
