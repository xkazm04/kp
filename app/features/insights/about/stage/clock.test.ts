// The scene clock's decisions, tested without a DOM.
//
// `useSceneClock` owns three subscriptions (viewport, motion preference, page
// visibility) and `clock.ts` owns what they mean. The term that was missing for
// a whole release is the reason this file exists: `useInView` measures
// geometry, a backgrounded tab keeps its geometry, so every scene the reader
// had scrolled to went on ticking — one 900ms interval each, re-rendering a
// whole diagram subtree, in a tab nobody was looking at.
//
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";

import { isVisibleState, phaseOf, shouldTick } from "./clock.ts";

test("a scene ticks only when it is on screen, allowed to move, and the tab is open", () => {
  assert.equal(shouldTick({ inView: true, reduced: false, visible: true }), true);

  assert.equal(shouldTick({ inView: false, reduced: false, visible: true }), false, "off screen");
  assert.equal(shouldTick({ inView: true, reduced: true, visible: true }), false, "reduced motion never creates a timer");
  assert.equal(
    shouldTick({ inView: true, reduced: false, visible: false }),
    false,
    "a backgrounded tab keeps its geometry — visibility is the term useInView cannot see"
  );
});

test("every combination that is not all three is off", () => {
  // Written as a truth table rather than as three cases because this predicate
  // is exactly the kind that silently loses a term when a fourth condition is
  // added later.
  for (const inView of [true, false]) {
    for (const reduced of [true, false]) {
      for (const visible of [true, false]) {
        assert.equal(
          shouldTick({ inView, reduced, visible }),
          inView && !reduced && visible,
          `inView=${inView} reduced=${reduced} visible=${visible}`
        );
      }
    }
  }
});

test("visibilityState is read permissively — only \"hidden\" pauses", () => {
  // `prerender` and a missing document (SSR, this test) must not read as a
  // paused tab: the first is a page about to be shown, the second is a render
  // with no tab at all.
  assert.equal(isVisibleState("visible"), true);
  assert.equal(isVisibleState("prerender"), true);
  assert.equal(isVisibleState(undefined), true);
  assert.equal(isVisibleState("hidden"), false);
});

test("the phase wraps at read time, so the stored tick stays monotonic", () => {
  const opts = { reduced: false, stillTick: 11 };
  assert.equal(phaseOf(0, 14, opts), 0);
  assert.equal(phaseOf(13, 14, opts), 13);
  assert.equal(phaseOf(14, 14, opts), 0, "the loop restarts without the counter wrapping in state");
  assert.equal(phaseOf(31, 14, opts), 3, "and keeps wrapping on every later lap");
});

test("reduced motion pins the still frame regardless of the tick", () => {
  // `stillTick` is the one frame at which every module has reached its final
  // stage. Pinning rather than freezing is deliberate: a reader who flips the
  // OS preference mid-loop lands on the complete diagram, not on whichever
  // half-drawn beat happened to be showing.
  const opts = { reduced: true, stillTick: 11 };
  assert.equal(phaseOf(0, 14, opts), 11);
  assert.equal(phaseOf(7, 14, opts), 11);
  assert.equal(phaseOf(999, 14, opts), 11);
  assert.equal(phaseOf(0, 14, { reduced: true, stillTick: 20 }), 6, "a still frame past the cycle wraps like any beat");
});

test("a nonsense tick renders beat 0 rather than a beat no scene has a row for", () => {
  // A half-built diagram is what a reader sees when a phase lands off the
  // table, and it reads as a bug in the product rather than as one in the clock.
  const opts = { reduced: false, stillTick: 5 };
  assert.equal(phaseOf(-3, 14, opts), 0);
  assert.equal(phaseOf(Number.NaN, 14, opts), 0);
  assert.equal(phaseOf(2.7, 14, opts), 2, "a fractional tick is the beat it is inside");
  assert.equal(phaseOf(5, 0, opts), 0, "a zero cycle cannot divide — it is one still frame");
});
