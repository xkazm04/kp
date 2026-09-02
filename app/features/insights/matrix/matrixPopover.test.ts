import { test } from "node:test";
import assert from "node:assert/strict";
import { computePopoverPosition, popoverDims, POPOVER_MAX_VH, POPOVER_WIDTH } from "./matrixPopover.ts";

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

// grid-chrome-holds-the-floor. `PopoverDims` was declared and never passed: every
// placement clamped against the module's 320 × 340 default while the dialog it clamps is
// `w-80 max-h-[60vh]` — a height that is viewport-relative, so the constant was wrong in
// BOTH directions.

test("the declared dims mirror the dialog's own class list", () => {
  assert.equal(POPOVER_WIDTH, 320); // w-80
  assert.equal(popoverDims({ width: 1280, height: 900 }).height, 900 * POPOVER_MAX_VH); // max-h-[60vh]
});

test("a measured dialog wins over the ceiling — but never exceeds it", () => {
  // A short card on a tall window: the old 340 constant reserved room the popover did
  // not need and pushed it further down the page than necessary.
  assert.equal(popoverDims({ width: 1280, height: 1000 }, 220).height, 220);
  // …and a box reported mid-transition, taller than its own max-height, is capped.
  assert.equal(popoverDims({ width: 1280, height: 1000 }, 5000).height, 600);
  // A zero/absent measurement (first placement, dialog not mounted) falls back.
  assert.equal(popoverDims({ width: 1280, height: 1000 }, 0).height, 600);
  assert.equal(popoverDims({ width: 1280, height: 1000 }, null).height, 600);
});

test("on a SHORT viewport the real 60vh height places the popover, not the 340 guess", () => {
  // A 500px-tall window: 60vh = 300, so a cell ending at 420 has no room below it and
  // the card is pushed up to 500 - 300 - 8 = 192. The old 340 constant would have put it
  // at 152 — 40px higher than needed, over the cells the reader is comparing.
  const viewport = { width: 1024, height: 500 };
  const dims = popoverDims(viewport);
  const pos = computePopoverPosition({ left: 100, bottom: 420 }, viewport, dims);
  assert.equal(pos.top, 192);
  assert.ok(pos.top + (dims.height ?? 0) <= viewport.height, "the whole card stays on screen");
  // And a viewport shorter than 60vh-plus-margins still pins to the margin, never negative.
  const tiny = { width: 1024, height: 200 };
  assert.equal(computePopoverPosition({ left: 100, bottom: 150 }, tiny, popoverDims(tiny)).top, 72);
});

test("a mid-height viewport clamps against the measured card, keeping it fully visible", () => {
  const viewport = { width: 1024, height: 700 };
  const dims = popoverDims(viewport, 260); // a short card: 260 < 60vh (420)
  const pos = computePopoverPosition({ left: 100, bottom: 600 }, viewport, dims);
  assert.equal(pos.top, 700 - 260 - 8, "the bottom edge sits one margin above the fold");
  assert.ok(pos.top + 260 <= viewport.height, "and the whole card is on screen");
});
